import json

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
            't_ute'              : 'Outdoor temp.',
            't_rum_ar'           : 'Indoor temp.',
            't_rum_ar_dec'       : 'Indoor temp., decimal',
            't_rum_bor'          : 'Indoor target temp.',
            't_rum_bor_dec'      : 'Indoor target temp., decimal',
            't_fram'             : 'Supplyline temp.',
            't_retur'            : 'Returnline temp.',
            't_vatten'           : 'Hotwater temp.',
            't_brine_ut'         : 'Brine out temp.',
            't_brine_in'         : 'Brine in temp.',
            't_kylning'          : 'Cooling temp.',
            't_fram_shunt'       : 'Supplyline temp., shunt',
            'stromforbr'         : 'Electrical Current',
            'ts_1'               : 'Aux. heater 3 kW',
            'ts_2'               : 'Aux. heater 6 kW',
            't_fram_bor'         : 'Supplyline target temp.',
            't_fram_shunt_bor'   : 'Supplyline target temp., shunt',
            'brine'              : 'Brinepump',
            'kompr'              : 'Compressor',
            'cirkp'              : 'Flowlinepump',
            'varmvatten'         : 'Hotwater production.',
            'ts2'                : 'Auxilliary 2',
            'shuntn'             : 'Shunt -',
            'shuntp'             : 'Shunt +',
            'ts1'                : 'Auxilliary 1',
            'shntgrpn'           : 'Shuntgroup -',
            'shntgrpp'           : 'Shuntgroup +',
            'shnt_kyln'          : 'Shunt cooling -',
            'shnt_kylp'          : 'Shunt cooling +',
            'akt_kyl'            : 'Active cooling',
            'pass_kyl'           : 'Passive cooling',
            'larm'               : 'Alarm',
            'pwm_ut'             : 'PWM Out',
            'alm_hp'             : 'Alarm highpr.pressostate',
            'alm_lp'             : 'Alarm lowpr.pressostate',
            'alm_ms'             : 'Alarm motorcircuit breaker',
            'alm_blf'            : 'Alarm low flow brine',
            'alm_blt'            : 'Alarm low temp. brine',
            'alm_ute'            : 'Alarm outdoor t-sensor',
            'alm_fram'           : 'Alarm supplyline t-sensor',
            'alm_retur'          : 'Alarm returnline t-sensor',
            'alm_vv'             : 'Alarm hotw. t-sensor',
            'alm_rum'            : 'Alarm indoor t-sensor',
            'alm_fas'            : 'Alarm incorrect 3-phase order',
            'alm_ovrh'           : 'Alarm overheating',
            'behov1'             : 'DEMAND1',
            'behov2'             : 'DEMAND2',
            'tryckr_t'           : 'Pressurepipe temp.',
            'hgw_vv'             : 'Hotw. supplyline temp.',
            'integr'             : 'Integral',
            'intgr_steg'         : 'Integral, reached A-limit',
            'clk_vv'             : 'Defrost',
            'min_time_start'     : 'Minimum time to start',
            'sw_ver'             : 'Program version',
            'cirk_speed'         : 'Flowlinepump speed',
            'brine_speed'        : 'Brinepump speed',
            'clk_vv_stop'        : 'STATUS3',
            'rum_bor2'           : 'Indoor target temp.',
            'dl'                 : 'Mode',
            'kurva'              : 'Curve',
            'kurva_min'          : 'Curve min',
            'kurva_max'          : 'Curve max',
            'kurva_p5'           : 'Curve +5',
            'kurva_0'            : 'Curve 0',
            'kurva_n5'           : 'Curve -5',
            'varme_stp'          : 'Heatstop',
            'sankn_t'            : 'Temp. reduction',
            'rumfakt'            : 'Room factor',
            'kurva2'             : 'Curve 2',
            'kurva2_min'         : 'Curve 2 min',
            'kurva2_max'         : 'Curve 2 max',
            'kurva2_bor'         : 'Curve 2, Target',
            'kurva2_ar'          : 'Curve 2, Actual',
            'status6'            : 'Outdoor stop temp. (20=-20C)',
            'tryckr_limit'       : 'Pressurepipe, temp. limit',
            'vv_start'           : 'Hotwater starttemp.',
            'vv_tid'             : 'Hotwater operating time',
            'varme_tid'          : 'Heatpump operating time',
            'leg_interv'         : 'Legionella interval',
            'leg_stop_t'         : 'Legionella stop temp.',
            'integr_a1'          : 'Integral limit A1',
            'hyst_vp'            : 'Hysteresis, heatpump',
            'max_ret'            : 'Returnline temp., max limit',
            'min_st_int'         : 'Minimum starting interval',
            'min_brine_t'        : 'Brinetemp., min limit (-15=OFFV)',
            'kyla_bor'           : 'Cooling, target',
            'integr_a2'          : 'Integral limit A2',
            'hyst_ts'            : 'Hysteresis limit, aux',
            'max_steg_ts'        : 'Max step, aux',
            'max_strom'          : 'Electrical current, max limit',
            'shunttid'           : 'Shunt time',
            'vv_stop'            : 'Hotwater stop temp.',
            'test_mode'          : 'Manual test mode',
            'status7'            : 'DT_LARMOFF',
            'lang'               : 'Language',
            'status8'            : 'SERVFAS',
            'fabriksinst'        : 'Factory settings',
            'reset_dr_tid'       : 'Reset runtime counters',
            'cal_ute'            : 'Calibration outdoor sensor',
            'cal_fram'           : 'Calibration supplyline sensor',
            'cal_ret'            : 'Calibration returnline sensor',
            'cal_vv'             : 'Calibration hotwater sensor',
            'cal_brut'           : 'Calibration brine out sensor',
            'cal_brin'           : 'Calibration brine in sensor',
            'sys_typ'            : 'Heating system type 0=VL 4=D',
            'till_fasm'          : 'Add-on phase order measurement',
            'till_2'             : 'TILL2',
            'till_hgw'           : 'Add-on HGW',
            'till_4'             : 'TILL4',
            'till_5'             : 'TILL5',
            'till_6'             : 'TILL6',
            'till_opt'           : 'Add-on Optimum',
            'till_fw'            : 'Add-on flow guard',
            'log_tim'            : 'Logging time',
            'brine_tim_on'       : 'Brine run-out duration',
            'brine_tim_off'      : 'Brine run-in duration',
            'leg_top_on'         : 'Legionella peak heating enable',
            'leg_top_tim'        : 'Legionella peak heating duration',
            'dr_tim_vp'          : 'Runtime compressor',
            'status10'           : 'DVP_MSD1',
            'dr_tim_ts1'         : 'Runtime 3 kW',
            'status11'           : 'DTS_MSD1',
            'dr_tim_vv'          : 'Runtime hotwater production',
            'status12'           : 'DVV_MSD1',
            'dr_tim_pas_kyl'     : 'Runtime passive cooling',
            'status13'           : 'DPAS_MSD1',
            'dr_tim_akt_kyl'     : 'Runtime active cooling',
            'status14'           : 'DACT_MSD1',
            'dr_tim_ts2'         : 'Runtime 6 kW',
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
        mdict = {self.get_name(k) : v for (k,n), v in self.values.items()}
        return json.dumps(mdict)
