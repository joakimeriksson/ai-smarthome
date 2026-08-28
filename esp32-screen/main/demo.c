#include "demo.h"
#include "config.h"
#include "ui.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <time.h>
#include <sys/time.h>
#include "esp_partition.h"
#include "esp_log.h"
#include "cJSON.h"

#define DEMO_SUBTYPE 0x40
static const char *TAG = "demo";
static cJSON *s_doc;
static const panel_tile_t s_tiles[] = PANEL_TILES;
static bool s_on[PANEL_TILE_COUNT];

bool demo_load(void)
{
    const esp_partition_t *p = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, DEMO_SUBTYPE, "demo");
    if (!p) return false;
    size_t n = p->size > 65536 ? 65536 : p->size;
    char *buf = malloc(n + 1);
    if (!buf) return false;
    if (esp_partition_read(p, 0, buf, n) != ESP_OK || buf[0] != '{') { free(buf); return false; }   /* erased flash: 0xff */
    buf[n] = 0;
    for (size_t i = 0; i < n; i++) if ((unsigned char)buf[i] == 0xff) { buf[i] = 0; break; }
    s_doc = cJSON_Parse(buf);
    free(buf);
    if (!s_doc) { ESP_LOGW(TAG, "demo partition holds data that is not JSON"); return false; }
    return true;
}

static int floats(const cJSON *arr, float *out, int max)
{
    int n = 0; const cJSON *e;
    if (!cJSON_IsArray(arr)) return 0;
    cJSON_ArrayForEach(e, arr) { if (n >= max) break; out[n++] = (float)e->valuedouble; }
    return n;
}

static const char *str(const cJSON *o, const char *key, const char *dflt)
{
    const cJSON *e = cJSON_GetObjectItem(o, key);
    return cJSON_IsString(e) ? e->valuestring : dflt;
}

static void set_clock(void)
{
    setenv("TZ", TZ_STOCKHOLM, 1);
    tzset();
    struct tm tm = { 0 };
    const char *t = str(s_doc, "time", "");
    if (sscanf(t, "%d-%d-%dT%d:%d:%d", &tm.tm_year, &tm.tm_mon, &tm.tm_mday, &tm.tm_hour, &tm.tm_min, &tm.tm_sec) >= 5) {
        tm.tm_year -= 1900; tm.tm_mon -= 1; tm.tm_isdst = -1;
        struct timeval tv = { .tv_sec = mktime(&tm) };
        settimeofday(&tv, NULL);
    }
}

static void date_off(int days, char out[11])
{
    time_t t = time(NULL) + (time_t)days * 86400;
    struct tm tm; localtime_r(&t, &tm);
    strftime(out, 11, "%Y-%m-%d", &tm);
}

static void demo_toggle(int idx)
{
    if (idx < 0 || idx >= PANEL_TILE_COUNT || s_tiles[idx].kind != TILE_TOGGLE) return;
    s_on[idx] = !s_on[idx];
    ui_tile_set_active(idx, s_on[idx]);
}

void demo_apply(void)
{
    set_clock();
    static float v[PRICE_SLOTS_MAX];
    char d0[11], d1[11];
    date_off(0, d0); date_off(1, d1);
    const cJSON *prices = cJSON_GetObjectItem(s_doc, "prices");
    int n = floats(cJSON_GetObjectItem(prices, "today"), v, PRICE_SLOTS_MAX);
    if (n) ui_set_prices(0, v, n, d0);
    n = floats(cJSON_GetObjectItem(prices, "tomorrow"), v, PRICE_SLOTS_MAX);
    if (n) ui_set_prices(1, v, n, d1);

    /* hourly kWh: completed hours as given, the current hour pro rata */
    float hours[24];
    int nh = floats(cJSON_GetObjectItem(cJSON_GetObjectItem(s_doc, "energy"), "hours"), hours, 24);
    time_t now = time(NULL); struct tm tm; localtime_r(&now, &tm);
    int nb = tm.tm_hour + 1; if (nb > nh) nb = nh;
    if (nb > 0) {
        float bars[25], total = 0;
        for (int i = 0; i < nb; i++) { bars[i] = hours[i]; total += hours[i]; }
        float frac = tm.tm_min / 60.0f;
        total -= bars[nb - 1] * (1.0f - frac); bars[nb - 1] *= frac;
        ui_set_energy(bars, nb, total);
    }

    const cJSON *tiles = cJSON_GetObjectItem(s_doc, "tiles");
    for (int i = 0; i < PANEL_TILE_COUNT; i++) {
        const cJSON *e = cJSON_GetObjectItem(tiles, s_tiles[i].entity_id);
        if (cJSON_IsString(e)) { s_on[i] = strcmp(e->valuestring, "on") == 0; ui_tile_set_active(i, s_on[i]); }
        else if (cJSON_IsObject(e)) ui_tile_show_value(i, str(e, "value", "--"), str(e, "unit", ""));
    }
    const cJSON *hp = cJSON_GetObjectItem(s_doc, "header_power");
    if (cJSON_IsObject(hp)) ui_set_header_power(str(hp, "value", "--"), str(hp, "unit", ""));
    ui_set_online(true);
    ui_set_control_handler(demo_toggle);
    ESP_LOGI(TAG, "demo mode: %s, prices %d+%d slots, %d energy hours; network off", d0, n, n, nh);
}
