#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "esp_log.h"

#include "board.h"
#include "logbuf.h"
#include "settings.h"
#include "ui.h"
#include "ui_settings.h"
#include "net.h"
#include "prices.h"
#include "hass.h"
#include "energy.h"
#include "sidplay.h"
#include "demo.h"

static const char *TAG = "main";

void app_main(void)
{
    logbuf_init();

    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    settings_init();

    ESP_ERROR_CHECK(board_init());
    sidplay_init();     /* before ui_init: the SID page reads tune names */
    ui_init();
    ui_settings_init();

    if (demo_load()) {
        demo_apply();     /* energydata.json in the demo partition: no WiFi, no HA, no fetches */
    } else {
        ESP_ERROR_CHECK(net_init());
        prices_start();   /* core 0: fetch/cache/schedule */
        hass_start();     /* core 0: HA polling + control queue */
        energy_start();   /* core 0: hourly kWh bars from the meter */
    }

    ESP_LOGI(TAG, "up");
}
