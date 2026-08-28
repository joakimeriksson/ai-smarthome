#include "net.h"
#include "config.h"
#include "settings.h"

#include <string.h>
#include <time.h>
#include <stdlib.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"

#include "ui.h"

static const char *TAG = "net";

static EventGroupHandle_t s_ev;
#define EV_CONNECTED BIT0

static volatile bool s_scanning;   /* pauses auto-reconnect during AP scan */
static volatile int s_last_reason; /* last WiFi disconnect reason code */

static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t *d = data;
        s_last_reason = d->reason;
        ESP_LOGW(TAG, "wifi disconnect, reason %d", d->reason);
        xEventGroupClearBits(s_ev, EV_CONNECTED);
        ui_set_online(false);
        /* Endless reconnect attempts abort any AP scan — hold off while
         * the settings panel is scanning; scan_task reconnects after. */
        if (!s_scanning) esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        s_last_reason = 0;
        xEventGroupSetBits(s_ev, EV_CONNECTED);
        ui_set_online(true);
        ESP_LOGI(TAG, "got IP");
        esp_netif_sntp_start();   /* (re)start SNTP now that DNS can work */
    }
}

esp_err_t net_init(void)
{
    s_ev = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t wcfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wcfg));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, NULL));

    wifi_config_t sta = { 0 };
    strlcpy((char *)sta.sta.ssid, settings_wifi_ssid(), sizeof(sta.sta.ssid));
    strlcpy((char *)sta.sta.password, settings_wifi_pass(), sizeof(sta.sta.password));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &sta));
    ESP_ERROR_CHECK(esp_wifi_start());

    setenv("TZ", TZ_STOCKHOLM, 1);
    tzset();

    esp_sntp_config_t sntp_cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    sntp_cfg.start = false;   /* started from the got-IP event instead */
    ESP_ERROR_CHECK(esp_netif_sntp_init(&sntp_cfg));

    return ESP_OK;
}

bool net_online(void)
{
    return s_ev && (xEventGroupGetBits(s_ev) & EV_CONNECTED) != 0;   /* demo mode never calls net_init */
}

int net_last_disconnect_reason(void)
{
    return s_last_reason;
}

void net_wifi_apply(const char *ssid, const char *pass)
{
    s_last_reason = 0;
    settings_set_wifi(ssid, pass);
    wifi_config_t sta = { 0 };
    strlcpy((char *)sta.sta.ssid, ssid, sizeof(sta.sta.ssid));
    strlcpy((char *)sta.sta.password, pass, sizeof(sta.sta.password));
    esp_wifi_set_config(WIFI_IF_STA, &sta);
    esp_wifi_disconnect();
    esp_wifi_connect();
}

/* ---- async scan ---- */

#define SCAN_MAX 15
static net_scan_cb_t s_scan_cb;

static void scan_task(void *arg)
{
    static char ssids[SCAN_MAX][33];
    static wifi_ap_record_t recs[SCAN_MAX];
    int n = 0;

    wifi_scan_config_t sc = { .show_hidden = false };
    esp_err_t err = esp_wifi_scan_start(&sc, true);
    if (err != ESP_OK) {
        /* A connect attempt in progress blocks scanning — break it off */
        ESP_LOGW(TAG, "scan_start: %s, disconnecting and retrying",
                 esp_err_to_name(err));
        esp_wifi_disconnect();
        vTaskDelay(pdMS_TO_TICKS(500));
        err = esp_wifi_scan_start(&sc, true);
    }
    if (err == ESP_OK) {
        uint16_t num = SCAN_MAX;
        if (esp_wifi_scan_get_ap_records(&num, recs) == ESP_OK) {
            for (int i = 0; i < num; i++) {
                const char *ss = (const char *)recs[i].ssid;
                if (!ss[0]) continue;
                bool dup = false;
                for (int j = 0; j < n && !dup; j++) {
                    dup = strcmp(ssids[j], ss) == 0;
                }
                if (!dup) strlcpy(ssids[n++], ss, 33);
            }
        }
        ESP_LOGI(TAG, "scan found %d networks", n);
    } else {
        ESP_LOGW(TAG, "scan failed: %s", esp_err_to_name(err));
    }
    if (s_scan_cb) s_scan_cb((const char (*)[33])ssids, n);
    s_scanning = false;
    if (!net_online()) esp_wifi_connect();   /* resume reconnect attempts */
    vTaskDelete(NULL);
}

bool net_scan_start(net_scan_cb_t cb)
{
    if (s_scanning) return false;
    s_scanning = true;
    s_scan_cb = cb;
    if (xTaskCreatePinnedToCore(scan_task, "scan", 4096, NULL, 3, NULL, 0) != pdPASS) {
        s_scanning = false;
        return false;
    }
    return true;
}

void net_ip_str(char *buf, int sz)
{
    buf[0] = '\0';
    esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    esp_netif_ip_info_t ip;
    if (netif && esp_netif_get_ip_info(netif, &ip) == ESP_OK && ip.ip.addr) {
        snprintf(buf, sz, IPSTR, IP2STR(&ip.ip));
    }
}

int net_rssi(void)
{
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) return ap.rssi;
    return 0;
}

void net_wait_time(void)
{
    /* Poll the clock, not the SNTP semaphore — sync_wait() wakes only ONE
     * waiter per sync event, and several tasks block here. */
    int waited = 0;
    while (time(NULL) < 1600000000) {   /* pre-2020 = not synced yet */
        vTaskDelay(pdMS_TO_TICKS(1000));
        if (++waited % 15 == 0) ESP_LOGW(TAG, "waiting for NTP...");
    }
    ESP_LOGI(TAG, "time synced");
}

int net_http(const char *method, const char *url, const char *bearer,
             const char *json_body, char **out, int *out_len)
{
    if (out) *out = NULL;
    if (out_len) *out_len = 0;

    esp_http_client_config_t cfg = {
        .url = url,
        .timeout_ms = 12000,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .disable_auto_redirect = false,
        .max_redirection_count = 3,
    };
    esp_http_client_handle_t cli = esp_http_client_init(&cfg);
    if (!cli) return -1;

    esp_http_client_set_method(cli,
        strcmp(method, "POST") == 0 ? HTTP_METHOD_POST : HTTP_METHOD_GET);

    char auth[300];
    if (bearer) {
        snprintf(auth, sizeof(auth), "Bearer %s", bearer);
        esp_http_client_set_header(cli, "Authorization", auth);
    }
    if (json_body) {
        esp_http_client_set_header(cli, "Content-Type", "application/json");
    }

    int body_len = json_body ? (int)strlen(json_body) : 0;
    esp_err_t err = esp_http_client_open(cli, body_len);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "open failed: %s", esp_err_to_name(err));
        esp_http_client_cleanup(cli);
        return -2;
    }
    if (body_len > 0 &&
        esp_http_client_write(cli, json_body, body_len) != body_len) {
        esp_http_client_cleanup(cli);
        return -3;
    }

    (void)esp_http_client_fetch_headers(cli);   /* may be chunked: read loop below */
    int status = esp_http_client_get_status_code(cli);

    int cap = 32 * 1024, len = 0;
    char *buf = malloc(cap);   /* >8 KB -> lands in PSRAM per sdkconfig */
    if (!buf) {
        esp_http_client_cleanup(cli);
        return -4;
    }
    while (1) {
        if (len + 2048 > cap) {
            cap *= 2;
            char *nb = realloc(buf, cap);
            if (!nb) { free(buf); esp_http_client_cleanup(cli); return -4; }
            buf = nb;
        }
        int r = esp_http_client_read(cli, buf + len, cap - len - 1);
        if (r <= 0) break;
        len += r;
    }
    buf[len] = '\0';
    esp_http_client_cleanup(cli);

    if (out) *out = buf; else free(buf);
    if (out_len) *out_len = len;
    return status;
}
