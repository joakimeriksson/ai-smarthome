import json
import time
class ThermIQ:

    def __init__(self):
        vpreg = {}
        vpreg[(0,0)] = "T_UTE"
        vpreg[(1,0)] = "T_RUM_AR"
        vpreg[(2,0)] = "T_RUM_AR_DEC"
        vpreg[(3,0)] = "T_RUM_BOR"
        vpreg[(4,0)] = "T_RUM_BOR_DEC"
        vpreg[(5,0)] = "T_FRAM"
        vpreg[(6,0)] = "T_RETUR"
        vpreg[(7,0)] = "T_VATTEN"
        vpreg[(8,0)] = "T_BRINE_UT"
        vpreg[(9,0)] = "T_BRINE_IN"
        vpreg[(10,0)] = "T_KYLNING"
        vpreg[(11,0)] = "T_FRAM_SHUNT"
        vpreg[(12,0)] = "STROMFORBR"
        vpreg[(13,1)] = "TS_1"
        vpreg[(13,2)] = "TS_2"
        vpreg[(14,0)] = "T_FRAM_BOR"
        vpreg[(15,0)] = "T_FRAM_SHUNT_BOR"
        vpreg[(16,1)] = "BRINE"
        vpreg[(16,2)] = "KOMPR"
        vpreg[(16,3)] = "CIRKP"
        vpreg[(16,4)] = "VARMVATTEN"
        vpreg[(16,5)] = "TS2"
        vpreg[(16,6)] = "SHUNTN"
        vpreg[(16,7)] = "SHUNTP"
        vpreg[(16,8)] = "TS1"
        vpreg[(17,1)] = "SHNTGRPN"
        vpreg[(17,2)] = "SHNTGRPP"
        vpreg[(17,3)] = "SHNT_KYLN"
        vpreg[(17,4)] = "SHNT_KYLP"
        vpreg[(17,5)] = "AKT_KYL"
        vpreg[(17,6)] = "PASS_KYL"
        vpreg[(17,7)] = "LARM"
        vpreg[(18,0)] = "PWM_UT"
        vpreg[(19,1)] = "ALM_HP"
        vpreg[(19,2)] = "ALM_LP"
        vpreg[(19,3)] = "ALM_MS"
        vpreg[(19,5)] = "ALM_BLT"
        vpreg[(19,4)] = "ALM_BLF"
        vpreg[(20,1)] = "ALM_UTE"
        vpreg[(20,2)] = "ALM_FRAM"
        vpreg[(20,3)] = "ALM_RETUR"
        vpreg[(20,4)] = "ALM_VV"
        vpreg[(20,5)] = "ALM_RUM"
        vpreg[(20,6)] = "ALM_OVRH"
        vpreg[(20,7)] = "ALM_FAS"
        vpreg[(21,0)] = "BEHOV1"
        vpreg[(22,0)] = "BEHOV2"
        vpreg[(23,0)] = "TRYCKR_T"
        vpreg[(24,0)] = "HGW_VV"
        vpreg[(25,0)] = "INTEGR"
        vpreg[(26,0)] = "INTGR_STEG"
        vpreg[(27,0)] = "CLK_VV"
        vpreg[(28,0)] = "MIN_TIME_START"
        vpreg[(29,0)] = "SW_VER"
        vpreg[(30,0)] = "CIRK_SPEED"
        vpreg[(31,0)] = "BRINE_SPEED"
        vpreg[(32,0)] = "CLK_VV_STOP"
        vpreg[(50,0)] = "RUM_BOR2"
        vpreg[(51,0)] = "DL"
        vpreg[(52,0)] = "KURVA"
        vpreg[(53,0)] = "KURVA_MIN"
        vpreg[(54,0)] = "KURVA_MAX"
        vpreg[(55,0)] = "KURVA_P5"
        vpreg[(56,0)] = "KURVA_0"
        vpreg[(57,0)] = "KURVA_N5"
        vpreg[(58,0)] = "VARME_STP"
        vpreg[(59,0)] = "SANKN_T"
        vpreg[(60,0)] = "RUMFAKT"
        vpreg[(61,0)] = "KURVA2"
        vpreg[(62,0)] = "KURVA2_MIN"
        vpreg[(63,0)] = "KURVA2_MAX"
        vpreg[(64,0)] = "STATUS4"
        vpreg[(65,0)] = "STATUS5"
        vpreg[(66,0)] = "STATUS6"
        vpreg[(67,0)] = "TRYCKR_LIMIT"
        vpreg[(68,0)] = "VV_START"
        vpreg[(69,0)] = "VV_TID"
        vpreg[(70,0)] = "VARME_TID"
        vpreg[(71,0)] = "LEG_INTERV"
        vpreg[(72,0)] = "LEG_STOP_T"
        vpreg[(73,0)] = "INTEGR_A1"
        vpreg[(74,0)] = "HYST_VP"
        vpreg[(75,0)] = "MAX_RET"
        vpreg[(76,0)] = "MIN_ST_INT"
        vpreg[(77,0)] = "MIN_BRINE_T"
        vpreg[(78,0)] = "KYLA_BOR"
        vpreg[(79,0)] = "INTEGR_A2"
        vpreg[(80,0)] = "HYST_TS"
        vpreg[(81,0)] = "MAX_STEG_TS"
        vpreg[(82,0)] = "MAX_STROM"
        vpreg[(83,0)] = "SHUNTTID"
        vpreg[(84,0)] = "VV_STOP"
        vpreg[(85,0)] = "TEST_MODE"
        vpreg[(86,0)] = "STATUS7"
        vpreg[(87,0)] = "LANG"
        vpreg[(88,0)] = "STATUS8"
        vpreg[(89,0)] = "FABRIKSINST"
        vpreg[(90,0)] = "RESET_DR_TID"
        vpreg[(91,0)] = "CAL_UTE"
        vpreg[(92,0)] = "CAL_FRAM"
        vpreg[(93,0)] = "CAL_RET"
        vpreg[(94,0)] = "CAL_VV"
        vpreg[(95,0)] = "CAL_BRUT"
        vpreg[(96,0)] = "CAL_BRIN"
        vpreg[(97,0)] = "SYS_TYP"
        vpreg[(98,1)] = "TILL_FASM"
        vpreg[(98,2)] = "TILL_2"
        vpreg[(98,3)] = "TILL_HGW"
        vpreg[(98,4)] = "TILL_4"
        vpreg[(98,5)] = "TILL_5"
        vpreg[(98,6)] = "TILL_6"
        vpreg[(98,7)] = "TILL_OPT"
        vpreg[(98,8)] = "TILL_FW"
        vpreg[(99,0)] = "LOG_TIM"
        vpreg[(100,0)] = "BRINE_TIM_ON"
        vpreg[(101,0)] = "BRINE_TIM_OFF"
        vpreg[(102,0)] = "LEG_TOP_ON"
        vpreg[(103,0)] = "LEG_TOP_TIM"
        vpreg[(104,0)] = "DR_TIM_VP"
        vpreg[(105,0)] = "STATUS10"
        vpreg[(106,0)] = "DR_TIM_TS1"
        vpreg[(107,0)] = "STATUS11"
        vpreg[(108,0)] = "DR_TIM_VV"
        vpreg[(109,0)] = "STATUS12"
        vpreg[(110,0)] = "DR_TIM_PAS_KYL"
        vpreg[(111,0)] = "STATUS13"
        vpreg[(112,0)] = "DR_TIM_AKT_KYL"
        vpreg[(113,0)] = "STATUS14"
        vpreg[(114,0)] = "DR_TIM_TS2"
        vpreg[(115,0)] = "STATUS15"
        vpreg[(116,0)] = "STATUS16"

        types = {}
        types["T_UTE"] = "C"
        types["T_UTE_MAX"] = "C"
        types["T_UTE_MIN"] = "C"
        types["T_RUM_AR"] = "C"
        types["T_RUM_AR_DEC"] = "0.1C"
        types["T_RUM_BOR"] = "C"
        types["T_RUM_BOR_DEC"] = "0.1C"
        types["T_FRAM"] = "C"
        types["T_FRAM_MAX"] = "C"
        types["T_FRAM_MIN"] = "C"
        types["T_RETUR"] = "C"
        types["T_RETUR_MAX"] = "C"
        types["T_RETUR_MIN"] = "C"
        types["T_VATTEN"] = "C"
        types["T_VATTEN_MAX"] = "C"
        types["T_VATTEN_MIN"] = "C"
        types["T_BRINE_UT"] = "C"
        types["T_BRINE_UT_MIN"] = "C"
        types["T_BRINE_IN"] = "C"
        types["T_BRINE_IN_MIN"] = "C"
        types["T_KYLNING"] = "C"
        types["T_FRAM_SHUNT"] = "C"
        types["STROMFORBR"] = "A"
        types["TS_1"] = "Boolsk"
        types["TS_2"] = "Boolsk"
        types["TS_P"] = "kW"
        types["TS_E"] = "kWh"
        types["T_FRAM_BOR"] = "C"
        types["T_FRAM_SHUNT_BOR"] = "C"
        types["BRINE"] = "Boolsk"
        types["KOMPR"] = "Boolsk"
        types["KOMPR_M"] = "min/h"
        types["KOMPR_H"] = "h"
        types["CIRKP"] = "Boolsk"
        types["VARMVATTEN"] = "Boolsk"
        types["VARMVATTEN_M"] = "min/h"
        types["VARMVATTEN_H"] = "h"
        types["TS2"] = "Boolsk"
        types["SHUNTN"] = "Boolsk"
        types["SHUNTP"] = "Boolsk"
        types["TS1"] = "Boolsk"
        types["SHNTGRPN"] = "Boolsk"
        types["SHNTGRPP"] = "Boolsk"
        types["SHNT_KYLN"] = "Boolsk"
        types["SHNT_KYLP"] = "Boolsk"
        types["AKT_KYL"] = "Boolsk"
        types["PASS_KYL"] = "Boolsk"
        types["LARM"] = "Boolsk"
        types["PWM_UT"] = "Enheter"
        types["ALM_HP"] = "Boolsk"
        types["ALM_LP"] = "Boolsk"
        types["ALM_MS"] = "Boolsk"
        types["ALM_BLT"] = "Boolsk"
        types["ALM_BLF"] = "Boolsk"
        types["ALM_UTE"] = "Boolsk"
        types["ALM_FRAM"] = "Boolsk"
        types["ALM_RETUR"] = "Boolsk"
        types["ALM_VV"] = "Boolsk"
        types["ALM_RUM"] = "Boolsk"
        types["ALM_OVRH"] = "Boolsk"
        types["ALM_FAS"] = "Boolsk"
        types["BEHOV1"] = "  "
        types["BEHOV2"] = "  "
        types["TRYCKR_T"] = "C"
        types["TRYCKR_T_MAX"] = "C"
        types["HGW_VV"] = "C"
        types["HGW_VV_MAX"] = "C"
        types["INTEGR"] = "C*min"
        types["INTEGR_DIV"] = "10C*min"
        types["INTEGR_MAX"] = "10C*min"
        types["INTEGR_MIN"] = "10C*min"
        types["INTGR_STEG"] = "  "
        types["CLK_VV"] = "*10s"
        types["MIN_TIME_START"] = "min"
        types["SW_VER"] = "  "
        types["CIRK_SPEED"] = "%"
        types["CIRK_SPEED_MAX"] = "%"
        types["BRINE_SPEED"] = "%"
        types["BRINE_SPEED_MAX"] = "%"
        types["CLK_VV_STOP"] = "  "
        types["RUM_BOR2"] = "C"
        types["DL"] = "laege #"
        types["KURVA"] = "C"
        types["KURVA_MIN"] = "C"
        types["KURVA_MAX"] = "C"
        types["KURVA_P5"] = "C"
        types["KURVA_0"] = "C"
        types["KURVA_N5"] = "C"
        types["VARME_STP"] = "C"
        types["SANKN_T"] = "C"
        types["RUMFAKT"] = "C"
        types["KURVA2"] = "C"
        types["KURVA2_MIN"] = "C"
        types["KURVA2_MAX"] = "C"
        types["STATUS4"] = "C"
        types["STATUS5"] = "C"
        types["STATUS6"] = "C"
        types["TRYCKR_LIMIT"] = "C"
        types["VV_START"] = "C"
        types["VV_TID"] = "min"
        types["VARME_TID"] = "min"
        types["LEG_INTERV"] = "dygn"
        types["LEG_STOP_T"] = "C"
        types["INTEGR_A1"] = "C*min"
        types["HYST_VP"] = "C"
        types["MAX_RET"] = "C"
        types["MIN_ST_INT"] = "min"
        types["MIN_BRINE_T"] = "C"
        types["KYLA_BOR"] = "C"
        types["INTEGR_A2"] = "10 C*min"
        types["HYST_TS"] = "C"
        types["MAX_STEG_TS"] = "antal"
        types["MAX_STROM"] = "A"
        types["SHUNTTID"] = "s"
        types["VV_STOP"] = "C"
        types["TEST_MODE"] = "laege #"
        types["STATUS7"] = "  "
        types["LANG"] = "sprak #"
        types["STATUS8"] = "  "
        types["FABRIKSINST"] = "inst #"
        types["RESET_DR_TID"] = "Boolsk"
        types["CAL_UTE"] = "C"
        types["CAL_FRAM"] = "C"
        types["CAL_RET"] = "C"
        types["CAL_VV"] = "C"
        types["CAL_BRUT"] = "C"
        types["CAL_BRIN"] = "C"
        types["SYS_TYP"] = "typ #"
        types["TILL_FASM"] = "Boolsk"
        types["TILL_HGW"] = "Boolsk"
        types["TILL_OPT"] = "Boolsk"
        types["TILL_FW"] = "Boolsk"
        types["LOG_TIM"] = "min"
        types["BRINE_TIM_ON"] = "10 s"
        types["BRINE_TIM_OFF"] = "10 s"
        types["LEG_TOP_ON"] = "Boolsk"
        types["LEG_TOP_TIM"] = "h"
        types["DR_TIM_VP"] = "h"
        types["STATUS10"] = "  "
        types["DR_TIM_TS1"] = "h"
        types["STATUS11"] = "  "
        types["DR_TIM_VV"] = "h"
        types["STATUS12"] = "  "
        types["DR_TIM_PAS_KYL"] = "h"
        types["STATUS13"] = "  "
        types["DR_TIM_AKT_KYL"] = "h"
        types["STATUS14"] = "  "
        types["DR_TIM_TS2"] = "h"
        types["STATUS15"] = "  "
        types["STATUS16"] = "  "

        id_names = {  
            't_ute'              : 'OutdoorTemp',
            't_rum_ar'           : 'IndoorTemp',
            't_rum_ar_dec'       : 'IndoorTempDecimal',
            't_rum_bor'          : 'IndoorTargetTemp',
            't_rum_bor_dec'      : 'IndoorTargetTempDecimal',
            't_fram'             : 'SupplylineTemp',
            't_retur'            : 'ReturnlineTemp',
            't_vatten'           : 'HotwaterTemp',
            't_brine_ut'         : 'BrineOutTemp',
            't_brine_in'         : 'BrineInTemp',
            't_kylning'          : 'CoolingTemp',
            't_fram_shunt'       : 'SupplylineTempShunt',
            'stromforbr'         : 'ElectricalCurrent',
            'ts_1'               : 'AuxHeater3kW',
            'ts_2'               : 'AuxHeater6kW',
            't_fram_bor'         : 'SupplylineTargetTemp',
            't_fram_shunt_bor'   : 'SupplylineTargetTempShunt',
            'brine'              : 'BrinePump',
            'kompr'              : 'Compressor',
            'cirkp'              : 'FlowlinePump',
            'varmvatten'         : 'HotwaterProduction.',
            'ts2'                : 'Auxilliary2',
            'shuntn'             : 'ShuntMinus',
            'shuntp'             : 'ShuntPlus',
            'ts1'                : 'Auxilliary1',
            'shntgrpn'           : 'ShuntgroupMinus',
            'shntgrpp'           : 'ShuntgroupPlus',
            'shnt_kyln'          : 'ShuntCoolingMinus',
            'shnt_kylp'          : 'ShuntCoolingPlus',
            'akt_kyl'            : 'ActiveCooling',
            'pass_kyl'           : 'PassiveCooling',
            'larm'               : 'Alarm',
            'pwm_ut'             : 'PWMOut',
            'alm_hp'             : 'AlarmhighprPressostate',
            'alm_lp'             : 'AlarmlowprPressostate',
            'alm_ms'             : 'AlarmmotorcircuitBreaker',
            'alm_blf'            : 'AlarmLowFlowBrine',
            'alm_blt'            : 'AlarmLowTempBrine',
            'alm_ute'            : 'AlarmOutdoor t-sensor',
            'alm_fram'           : 'AlarmSupplyline t-sensor',
            'alm_retur'          : 'AlarmReturnline t-sensor',
            'alm_vv'             : 'AlarmHotwTsensor',
            'alm_rum'            : 'AlarmIndoorTsensor',
            'alm_fas'            : 'AlarmIncorrect3phaseOrder',
            'alm_ovrh'           : 'AlarmOverheating',
            'behov1'             : 'DEMAND1',
            'behov2'             : 'DEMAND2',
            'tryckr_t'           : 'PressurepipeTemp',
            'hgw_vv'             : 'HotwsupplylineTemp',
            'integr'             : 'Integral',
            'intgr_steg'         : 'IntegralReachedAlimit',
            'clk_vv'             : 'Defrost',
            'min_time_start'     : 'MinimumTimeToStart',
            'sw_ver'             : 'ProgramVersion',
            'cirk_speed'         : 'FlowlinepumpSpeed',
            'brine_speed'        : 'BrinepumpSpeed',
            'clk_vv_stop'        : 'STATUS3',
            'rum_bor2'           : 'IndoorTargetTemp',
            'dl'                 : 'Mode',
            'kurva'              : 'Curve',
            'kurva_min'          : 'CurveMin',
            'kurva_max'          : 'CurveMax',
            'kurva_p5'           : 'CurvePlus5',
            'kurva_0'            : 'Curve0',
            'kurva_n5'           : 'CurveMinus5',
            'varme_stp'          : 'Heatstop',
            'sankn_t'            : 'TempReduction',
            'rumfakt'            : 'RoomFactor',
            'kurva2'             : 'Curve2',
            'kurva2_min'         : 'Curve2Min',
            'kurva2_max'         : 'Curve2Max',
            'kurva2_bor'         : 'Curve2Target',
            'kurva2_ar'          : 'Curve2Actual',
            'status6'            : 'OutdoorStopTemp',
            'tryckr_limit'       : 'PressurepipeTempLimit',
            'vv_start'           : 'HotwaterStarttemp',
            'vv_tid'             : 'HotwaterOperatingTime',
            'varme_tid'          : 'HeatpumpOperatingTime',
            'leg_interv'         : 'LegionellaInterval',
            'leg_stop_t'         : 'LegionellaStopTemp',
            'integr_a1'          : 'IntegralLimitA1',
            'hyst_vp'            : 'HysteresisHeatpump',
            'max_ret'            : 'ReturnlineTempMaxLimit',
            'min_st_int'         : 'MinimumStartingInterval',
            'min_brine_t'        : 'BrineTempMinLimit',
            'kyla_bor'           : 'CoolingTarget',
            'integr_a2'          : 'IntegralLimitA2',
            'hyst_ts'            : 'HysteresisLimitAux',
            'max_steg_ts'        : 'MaxStepAux',
            'max_strom'          : 'ElectricalCurrentMaxLimit',
            'shunttid'           : 'ShuntTime',
            'vv_stop'            : 'HotwaterStopTemp.',
            'test_mode'          : 'ManualTestMode',
            'status7'            : 'DTLARMOFF',
            'lang'               : 'Language',
            'status8'            : 'SERVFAS',
            'fabriksinst'        : 'FactorySettings',
            'reset_dr_tid'       : 'ResetRuntimeCounters',
            'cal_ute'            : 'CalibrationOutdoorSensor',
            'cal_fram'           : 'CalibrationSupplylineSensor',
            'cal_ret'            : 'CalibrationReturnlineSensor',
            'cal_vv'             : 'CalibrationHotwaterSensor',
            'cal_brut'           : 'CalibrationBrineOutSensor',
            'cal_brin'           : 'CalibrationBrineInSensor',
            'sys_typ'            : 'HeatingSystemType',
            'till_fasm'          : 'AddonPhaseOrderMeasurement',
            'till_2'             : 'TILL2',
            'till_hgw'           : 'AddonHGW',
            'till_4'             : 'TILL4',
            'till_5'             : 'TILL5',
            'till_6'             : 'TILL6',
            'till_opt'           : 'AddonOptimum',
            'till_fw'            : 'AddonFlowGuard',
            'log_tim'            : 'LoggingTime',
            'brine_tim_on'       : 'BrineRunOutDuration',
            'brine_tim_off'      : 'BrineRunInDuration',
            'leg_top_on'         : 'LegionellaPeakHeatingEnable',
            'leg_top_tim'        : 'LegionellaPeakHeatingDuration',
            'dr_tim_vp'          : 'RuntimeCompressor',
            'status10'           : 'DVP_MSD1',
            'dr_tim_ts1'         : 'Runtime3kW',
            'status11'           : 'DTS_MSD1',
            'dr_tim_vv'          : 'RuntimeHotwaterProduction',
            'status12'           : 'DVV_MSD1',
            'dr_tim_pas_kyl'     : 'RuntimePassiveCooling',
            'status13'           : 'DPAS_MSD1',
            'dr_tim_akt_kyl'     : 'RuntimeActiveCooling',
            'status14'           : 'DACT_MSD1',
            'dr_tim_ts2'         : 'Runtime6kW',
            'status15'           : 'DTS2_MSD1',
            'status16'           : 'GrafCounterOffSet',
            'indr_t'             : 'INDR_T',
        }
        
        self.vpreg = vpreg
        self.types = types
        self.id_names = id_names
        self.values = {}

    def set_value(self, reg, value):
        name = self.get_name(reg)
        if name in self.types and self.types[name] == "C":
            if value > 32768:
                value = value - 65536; 
        self.values[(reg,0)] = value

    def get_value(self, reg):
        return self.values[(reg, 0)]


    def get_name(self, reg):
        if (reg,0) in self.vpreg:
            return self.vpreg[(reg,0)]
        return "Flag:" + str(reg)

    def get_description(self, name):
        namelow = name.lower()
        if namelow in self.id_names:
            return self.id_names[namelow]
        return name
    def get_type(self, name):
        if name in self.types:
            return self.types[name]
        return "Boolsk"

    def json(self):
        mdict = {self.get_description(self.get_name(k)) : v for (k,n), v in self.values.items()}
        mdict['timestamp'] = time.time_ns() // 1000000
        return json.dumps(mdict)
