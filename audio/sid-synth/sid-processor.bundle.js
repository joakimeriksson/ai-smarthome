// Auto-generated bundle. Do not edit.
// Contains jsSID core + TinySID + worklet processor.

// Top level of jsSID, common bits, etc.

// top level object, overall control:w

// Not real sure what this may look like yet, just a stub for constructor for now.
function jsSID() {
}

jsSID.version = "0.0.1";

// chip configuration constants
jsSID.chip = Object.freeze({ 
	model: { MOS6581: 0, MOS8580: 1 },
	clock: { PAL: 985248, NTSC: 1022730 }
});

jsSID.synth = {};
// sid drivers will add entries of the form:
// jsSID.synth.somesid_o1 = {
//     desc: "TinySID"
//     opts: {} 
// }

// maps to driver names as an interim between old/new expressions on drivers
jsSID.quality = Object.freeze({
        low: "tinysid",
        medium: "fastsid",
        good: "resid_fast",
        better: "resid_interpolate",
        best: "resid_resample_interpolate",
        broken: "resid_resample_fast"
});

// static factory method
jsSID.synthFactory = function(f_opts) {
        //console.log("factory", f_opts);
        f_opts = f_opts || {};
        var f_quality = f_opts.quality || jsSID.quality.good;
        var engine = jsSID.synth[f_quality];
       
        var o = {};
	var key;
        for(key in engine.opts) {
          o[key] = engine.opts[key];
        }
        for(key in f_opts) {
          o[key] = f_opts[key];
        }

        o.clock = o.clock || jsSID.chip.clock.PAL;
        o.model = o.model || jsSID.chip.model.MOS6581;
        o.sampleRate = o.sampleRate || 44100;

        //console.log("factory, class:", engine.class);
        var f_newsid = new window.jsSID[engine.class](o);
        return f_newsid;
};



// Main TinySID Object
jsSID.TinySID = function(opts) {
        opts = opts || {};
	this.mix_freq = opts.sampleRate || 44100;	
	this.mem = opts.memory || null;

	this.freq_mul = Math.floor(15872000 / this.mix_freq);
	this.filt_mul = Math.floor(jsSID.TinySID.pFloat.convertFromFloat(21.5332031) / this.mix_freq);

	var attackTimes = new Array(
		0.0022528606, 0.0080099577, 0.0157696042, 0.0237795619,
		0.0372963655, 0.0550684591, 0.0668330845, 0.0783473987,
		0.0981219818, 0.244554021,  0.489108042,  0.782472742,
		0.977715461,  2.93364701,   4.88907793,   7.82272493
	);
	var decayReleaseTimes = new Array(
		0.00891777693, 0.024594051, 0.0484185907, 0.0730116639,
		0.114512475,   0.169078356, 0.205199432,  0.240551975,
		0.301266125,   0.750858245, 1.50171551,   2.40243682,
		3.00189298,    9.00721405,  15.010998,    24.0182111
	);

	this.attacks = new Array(16);
	this.releases = new Array(16);
	var i;
	for ( i = 0; i < 16; i++) {
		this.attacks[i]  = Math.floor(0x1000000 / ( attackTimes[i] * this.mix_freq ) );
		this.releases[i] = Math.floor(0x1000000 / ( decayReleaseTimes[i] * this.mix_freq ) );
	}

	// Start core sid registers
	this.v = new Array(3);
	for ( i = 0; i < 3; i++) {
		this.v[i] = new Object({
			freq: 0,		// word
			pulse: 0,		// word
			wave: 0,		// byte
			ad: 0,			// byte
			sr: 0			// byte
		});
	}
	this.ffreqlo = 0;	// byte
	this.ffreqhi = 0;	// byte
	this.res_ftv = 0;	// byte
	this.ftp_vol = 0;	// byte
	// End core sid registers
	
	// Internal representations
	this.osc = new Array(3);
	for ( i = 0; i < 3; i++) {
		this.osc[i] = new jsSID.TinySID.Osc(this, i);
		this.osc[i].noiseval = 0xffffff;
	}
	this.filter = new jsSID.TinySID.Filter(this);

	// internal values used to handle "Digi" sample handling
	this.internal_period = 0;
	this.internal_order = 0;
	this.internal_start = 0;
	this.internal_end = 0;
	this.internal_add = 0;
	this.internal_repeat_times = 0;
	this.internal_repeat_start = 0;

	// also related to digi handling
	this.sample_active = 0;
	this.sample_position = 0;
	this.sample_start = 0;
	this.sample_end = 0;
	this.sample_repeat_start = 0;
	this.fracPos = 0;         /* Fractal position of sample */
	this.sample_period = 0;
	this.sample_repeats = 0;
	this.sample_order = 0;
	this.sample_nibble = 0;

	// converted from statics in generateDigi
	this.sample = 0;
	//this.last_sample = 0;


}

// generate count samples into buffer at offset
jsSID.TinySID.prototype.generateIntoBuffer = function(count, buffer, offset) {
	//console.log("TinySID.generateIntoBuffer (count: " + count + ", offset: " + offset + ")");

	// FIXME: this could be done in one pass. (No?)
	for (var i = offset; i < offset + count; i++) {
		buffer[i] = 0;
	}

	var v;
	for ( v = 0; v < 3; v++) {
		this.osc[v].precalc();
	}
	this.filter.precalc();

	var bp;
	var endbp = count + offset;

	for (bp = offset; bp < endbp; bp += 1) {
		var outo = 0;
		var outf = 0;
		
		for ( v = 0; v < 3; v++) {
			var thisosc = this.osc[v];
			thisosc.sampleUpdate();

			if ( v < 2 || this.filter.v3ena) {
				if (thisosc.filter) {
					outf += ( ( thisosc.outv - 0x80 ) * thisosc.envval) >> 22;
				} else {
					outo += ( ( thisosc.outv - 0x80 ) * thisosc.envval) >> 22;
				}
			}

		}

		this.filter.h = jsSID.TinySID.pFloat.convertFromInt(outf) - (this.filter.b >> 8) * this.filter.rez - this.filter.l;
		this.filter.b += jsSID.TinySID.pFloat.multiply(this.filter.freq, this.filter.h);
		this.filter.l += jsSID.TinySID.pFloat.multiply(this.filter.freq, this.filter.b);

		outf = 0;
		if (this.filter.l_ena) outf += jsSID.TinySID.pFloat.convertToInt(this.filter.l);
		if (this.filter.b_ena) outf += jsSID.TinySID.pFloat.convertToInt(this.filter.b);
		if (this.filter.h_ena) outf += jsSID.TinySID.pFloat.convertToInt(this.filter.h);

		// FIXME: Digi support disabled for now
		var final_sample = parseFloat(this.generateDigi(this.filter.vol * ( outo + outf ))) / 32768;
		//var final_sample = parseFloat(this.filter.vol * ( outo + outf ) ) / 32768;
		buffer[bp] = final_sample;
	}
	return count;
};

jsSID.TinySID.prototype.generateDigi = function(sIn) {

	if ((!this.sample_active) || (this.mem === null)) return(sIn);

	if ((this.sample_position < this.sample_end) && (this.sample_position >= this.sample_start)) {
		//Interpolation routine
		//float a = (float)fracPos/(float)mixing_frequency;
		//float b = 1-a;
		//sIn += a*sample + b*last_sample;

		sIn += this.sample;

		this.fracPos += 985248 / this.sample_period;

		if (this.fracPos > this.mix_freq) {
			this.fracPos %= this.mix_freq;

			//this.last_sample = this.sample;

			if (this.sample_order === 0) {
				this.sample_nibble++;
				if (this.sample_nibble == 2) {
					this.sample_nibble = 0;
					this.sample_position++;
				}
			} else {
				this.sample_nibble--;
				if (this.sample_nibble < 0) {
					this.sample_nibble = 1;
					this.sample_position++;
				}
			}
			if (this.sample_repeats) {
				if (this.sample_position > this.sample_end) {
					this.sample_repeats--;
					this.sample_position = this.sample_repeat_start;
				} else {
					this.sample_active = 0;
				}
			}

			this.sample = this.mem[this.sample_position & 0xffff];
			if (this.sample_nibble == 1) {
				this.sample = (this.sample & 0xf0) >> 4;
			} else {
				this.sample = this.sample & 0x0f;
			}

			this.sample -= 7;
			this.sample <<= 10;
		}
	}

	return (sIn);
};

jsSID.TinySID.prototype.generate = function(samples) {
	var data = new Array(samples);
	this.generateIntoBuffer(samples, data, 0);
	return data;
};

jsSID.TinySID.prototype.poke = function(reg, val) {

	var voice = 0;
	//if ((reg >= 0) && (reg <= 6)) voice=0;
	if ((reg >= 7) && (reg <=13)) {voice=1; reg-=7;}
	else if ((reg >= 14) && (reg <=20)) {voice=2; reg-=14;}

	switch (reg) {
		case 0:
			this.v[voice].freq = (this.v[voice].freq & 0xff00) + val;
			break;
		case 1:
			this.v[voice].freq = (this.v[voice].freq & 0xff) + (val << 8);
			break;
		case 2:
			this.v[voice].pulse = (this.v[voice].pulse & 0xff00) + val;
			break;
		case 3:
			this.v[voice].pulse = (this.v[voice].pulse & 0xff) + (val << 8);
			break;
		case 4:
			this.v[voice].wave = val;
			if ((val & 0x01) === 0) this.osc[voice].envphase = 3;
			else if (this.osc[voice].envphase == 3) this.osc[voice].envphase = 0;
			break;
		case 5:
			this.v[voice].ad = val;
			break;
		case 6:
			this.v[voice].sr = val;
			break;
		case 21:
			this.ffreqlo = val;
			break;
		case 22:
			this.ffreqhi = val;
			break;
		case 23:
			this.res_ftv = val;
			break;
		case 24:
			this.ftp_vol = val;
			break;
	}
};

jsSID.TinySID.prototype.pokeDigi = function(addr, value) {

	// FIXME: Should be a switch/case block
	// Start-Hi
	if (addr == 0xd41f) {
		this.internal_start = (this.internal_start & 0x00ff) | (value << 8);
	}

	// Start-Lo
	if (addr == 0xd41e) {
		this.internal_start = (this.internal_start & 0xff00) | (value);
	}

	// Repeat-Hi
	if (addr == 0xd47f) {
		this.internal_repeat_start = (this.internal_repeat_start & 0x00ff) | (value << 8);
	}

	// Repeat-Lo
	if (addr == 0xd47e) {
		this.internal_repeat_start = (this.internal_repeat_start & 0xff00) | (value);
	}

	// End-Hi
	if (addr == 0xd43e) {
		this.internal_end = (this.internal_end & 0x00ff) | (value << 8);
	}

	// End-Lo
	if (addr == 0xd43d) {
		this.internal_end = (this.internal_end & 0xff00) | (value);
	}

	// Loop-Size
	if (addr == 0xd43f) {
		this.internal_repeat_times = value;
	}

	// Period-Hi
	if (addr == 0xd45e) {
		this.internal_period = (this.internal_period & 0x00ff) | (value << 8);
	}

	// Period-Lo
	if (addr == 0xd45d) {
		this.internal_period = (this.internal_period & 0xff00) | (value);
	}

	// Sample Order
	if (addr == 0xd47d) {
		this.internal_order = value;
	}

	// Sample Add
	if (addr == 0xd45f) {
		this.internal_add = value;
	}

	// Start-Sampling
	if (addr == 0xd41d)
	{
		this.sample_repeats = this.internal_repeat_times;
		this.sample_position = this.internal_start;
		this.sample_start = this.internal_start;
		this.sample_end = this.internal_end;
		this.sample_repeat_start = this.internal_repeat_start;
		this.sample_period = this.internal_period;
		this.sample_order = this.internal_order;
		switch (value)
		{
			case 0xfd:
				this.sample_active = 0;
				break;
			case 0xfe:
			case 0xff:
				this.sample_active = 1;
				break;
			default:
				return;
		}
	}

};


// FIXME: move up?
// val(dword), bit(byte), returns byte (1 or 0)
jsSID.TinySID.get_bit = function(val, bit) {
	return ((val >> bit) & 1);
};

// TinySID Filter Object
jsSID.TinySID.Filter = function(sidinstance) {
	this.sid = sidinstance;

	// internal filter def
	this.freq	= 0;		// int
	this.l_ena	= 0;		// byte
	this.b_ena	= 0;		// byte
	this.h_ena	= 0;		// byte
	this.v3ena	= 0;		// byte
	this.vol	= 0;		// int
	this.rez	= 0;		// int
	this.h		= 0;		// int
	this.b		= 0;		// int
	this.l		= 0;		// int
}

jsSID.TinySID.Filter.prototype.precalc = function() {
	//this.freq  = (4 * this.sid.ffreqhi + (this.sid.ffreqlo & 0x7)) * this.filt_mul;
	this.freq  = (16 * this.sid.ffreqhi + (this.sid.ffreqlo & 0x7)) * this.sid.filt_mul;

	if ( this.freq > jsSID.TinySID.pFloat.convertFromInt(1) ) {
		this.freq = jsSID.TinySID.pFloat.convertFromInt(1);
	}
	this.l_ena = jsSID.TinySID.get_bit(this.sid.ftp_vol,4);
	this.b_ena = jsSID.TinySID.get_bit(this.sid.ftp_vol,5);
	this.h_ena = jsSID.TinySID.get_bit(this.sid.ftp_vol,6);
	this.v3ena = !jsSID.TinySID.get_bit(this.sid.ftp_vol,7);
	this.vol   = (this.sid.ftp_vol & 0xf);
	this.rez   = jsSID.TinySID.pFloat.convertFromFloat(1.2) - jsSID.TinySID.pFloat.convertFromFloat(0.04) * (this.sid.res_ftv >> 4);
	this.rez   >>= 8;
};


// TinySID Oscilator Object
jsSID.TinySID.Osc = function(sidinstance, voicenum) {
	this.sid = sidinstance;
	this.vnum = voicenum;
	this.refosc = voicenum ? (voicenum - 1) : 2;
	this.v = sidinstance.v[voicenum];
	this.freq	= 0;		// dword
	this.pulse	= 0;		// dword
	this.wave	= 0;		// byte
	this.filter	= 0;		// byte
	this.attack	= 0;		// dword
	this.decay	= 0;		// dword
	this.sustain	= 0;		// dword
	this.release	= 0;		// dword
	this.counter	= 0;		// dword
	this.envval	= 0;		// signed int
	this.envphase	= 0;		// byte
	this.noisepos   = 0;		// dword
	this.noiseval   = 0xffffff;	// dword
	this.noiseout	= 0;		// byte
	this.triout	= 0;		// byte
	this.sawout	= 0;		// byte
	this.plsout	= 0;		// byte
	this.outv	= 0;		// byte

}

// Pre-calc values common to a sample set
jsSID.TinySID.Osc.prototype.precalc = function() {
	this.pulse   = (this.v.pulse & 0xfff) << 16;
	this.filter  = jsSID.TinySID.get_bit(this.sid.res_ftv, this.vnum);
	this.attack  = this.sid.attacks[this.v.ad >> 4];
	this.decay   = this.sid.releases[this.v.ad & 0xf];
	this.sustain = this.v.sr & 0xf0;
	this.release = this.sid.releases[this.v.sr & 0xf];
	this.wave    = this.v.wave;
	this.freq    = this.v.freq * this.sid.freq_mul;
};

// Called for each oscillator for each sample
jsSID.TinySID.Osc.prototype.sampleUpdate = function() {

	this.counter = ( this.counter + this.freq) & 0xFFFFFFF;
	if (this.wave & 0x08) {
		this.counter  = 0;
		this.noisepos = 0;
		this.noiseval = 0xffffff;
	}
	if (this.wave & 0x02) {
		var thisrefosc = this.sid.osc[this.refosc];
		if (thisrefosc.counter < thisrefosc.freq) {
			this.counter = Math.floor(thisrefosc.counter * this.freq / thisrefosc.freq);
		}
	}
	this.triout = (this.counter>>19) & 0xff;
	if ( this.counter >> 27) {
		this.triout ^= 0xff;
	}
	this.sawout = (this.counter >> 20) & 0xff;
	this.plsout = (this.counter > this.pulse) ? 0 : 0xff;
	if ( this.noisepos != ( this.counter >> 23 ) ) {
		this.noisepos = this.counter >> 23;
		this.noiseval = (this.noiseval << 1) | 
			(jsSID.TinySID.get_bit(this.noiseval,22) ^ jsSID.TinySID.get_bit(this.noiseval,17));
		this.noiseout = 
			(jsSID.TinySID.get_bit(this.noiseval,22) << 7) |
			(jsSID.TinySID.get_bit(this.noiseval,20) << 6) |
			(jsSID.TinySID.get_bit(this.noiseval,16) << 5) |
			(jsSID.TinySID.get_bit(this.noiseval,13) << 4) |
			(jsSID.TinySID.get_bit(this.noiseval,11) << 3) |
			(jsSID.TinySID.get_bit(this.noiseval, 7) << 2) |
			(jsSID.TinySID.get_bit(this.noiseval, 4) << 1) |
			(jsSID.TinySID.get_bit(this.noiseval, 2) << 0);
	}
	if (this.wave & 0x04) {
		if (this.sid.osc[this.refosc].counter < 0x8000000) {
			this.triout ^= 0xff;
		}
	}
	this.outv = 0xFF;
	if (this.wave & 0x10) this.outv &= this.triout;
	if (this.wave & 0x20) this.outv &= this.sawout;
	if (this.wave & 0x40) this.outv &= this.plsout;
	if (this.wave & 0x80) this.outv &= this.noiseout;

	// MOVED to poke (for now)
	//if ( !(this.wave & 0x01)) {
	//	this.envphase = 3;
	//} else if (this.envphase == 3) {
	//	this.envphase = 0;
	//}

	switch (this.envphase) {
		case 0:                          // Phase 0 : Attack
			this.envval += this.attack;
			if (this.envval >= 0xFFFFFF) {
				this.envval   = 0xFFFFFF;
				this.envphase = 1;
			}
			break;
		case 1:                          // Phase 1 : Decay
			this.envval -= this.decay;
			if (this.envval <= (this.sustain << 16)) {
				this.envval   = this.sustain << 16;
				this.envphase = 2;
			}
			break;
		case 2:                          // Phase 2 : Sustain
			if (this.envval != (this.sustain << 16)) {
				this.envphase = 1;
			}
			break;
		case 3:                          // Phase 3 : Release
			this.envval -= this.release;
			if (this.envval < 0x40000) {
				this.envval = 0x40000;
			}
			break;
	}
};


// start pFloat
jsSID.TinySID.pFloat = function() {}
jsSID.TinySID.pFloat.convertFromInt = function(i) {
	return (i<<16) & 0xffffffff;
};
jsSID.TinySID.pFloat.convertFromFloat = function(f) {
	return Math.floor(parseFloat(f) * 65536) & 0xffffffff;
};
jsSID.TinySID.pFloat.convertToInt = function(i) {
	return (i>>16) & 0xffffffff;
};
jsSID.TinySID.pFloat.multiply = function(a, b) {
	return ((a>>8)*(b>>8)) & 0xffffffff;
};
// end pFloat;


// add driver profile(s) to registry:
jsSID.synth.tinysid = {
	desc: "TinySID",
        class: "TinySID",
	opts: {}
}


// AudioWorkletProcessor that expects jsSID and jsSID.TinySID to be present (bundled above)

class SidProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.synth = null;
    this.ready = false;
    this.sampleCounter = 0;
    this.regs = new Uint8Array(0x20);
    this.instruments = [];
    this.currentStep = 0;
    this.bpm = 120;
    this.stepDurationSamples = 0;
    this.nextStepSample = 0;
    this.nextTickSample = 0;
    this.retriggerGap = 256;
    this.pendingGateOns = [];
    this.isGT2 = false;
    this.globalTempo = 6;
    this.funktempo = { active: false, left: 6, right: 6, state: 0 };
    // GT2 Tables
    this.tables = { ltable: [[], [], [], []], rtable: [[], [], [], []] };

    // GT2 voice state (no LFO - use PTBL/STBL/WTBL instead)
    this.voiceState = [0, 1, 2].map(() => ({
      active: false,
      instrument: null,
      instrumentIndex: -1,
      baseHz: 0,
      basePW: 0x0800,
      releaseUntilSample: 0,
      muted: false,
      // GT2 pattern command state
      activeCommand: 0,
      commandData: 0,
      currentFrequency: 0,
      targetFrequency: 0,
      transpose: 0,  // GT2 transpose amount in halftones

      // Portamento state
      portamentoSpeed: 0,
      portamentoActive: false,

      // Toneportamento state
      toneportaActive: false,
      toneportaTarget: 0,
      toneportaSpeed: 0,

      // Vibrato state
      vibratoActive: false,
      vibratoSpeed: 0,
      vibratoDepth: 0,
      vibratoPhase: 0,
      vibratoDirection: 1,

      // Base frequency (without modulation)
      baseFrequency: 0,

      // Table Execution State (Ported from GT2FrameEngine)
      // Pointers (1-based, 0 = inactive)
      ptr: [0, 0, 0, 0], // Wave, Pulse, Filter, Speed

      // Timers
      wavetime: 0,
      pulsetime: 0,
      filtertime: 0,
      speedtime: 0,

      // Current values (GT2 style: wave and gate are SEPARATE)
      wave: 0,       // Waveform value WITH gate bit (0x41=pulse+gate, etc.)
      gate: 0xFF,    // Gate mask (0xFF=pass all, 0xFE=clear gate bit)
      hrTimer: 0,    // Hard restart countdown (frames remaining, 0 = HR complete)
      tableNote: 0,
      tablePulse: 0x800,
      tableFilter: 0,
      tableSpeed: 1,

      // Modulation
      pulseModSpeed: 0,
      pulseModTicks: 0,
      filterModSpeed: 0,
      filterModTicks: 0,

      // Active flags
      waveActive: false,
      pulseActive: false,
      filterActive: false,
      speedActive: false,

      // Hard restart flag - prevents wavetable register writes until gate-on fires
      pendingGateOn: false
    }));
    // REMOVED: Old LFO timing - GT2 uses tables instead
    // GT2 tempo and tick timing
    this.tempo = 6; // Default GT2 tempo (in ticks per row)
    this.tickIntervalSamples = Math.floor(sampleRate / 50); // 50Hz PAL timing
    // Debug (enabled by default to help diagnose GT2 playback)
    this.debug = true;
    this.lastDebugSample = 0;

    this.port.onmessage = (event) => {
      const { type, payload } = event.data || {};
      if (type === 'init') {
        try {
          if (typeof jsSID === 'undefined' || typeof jsSID.TinySID === 'undefined') {
            throw new Error('TinySID not bundled');
          }
          this.synth = new jsSID.TinySID({ sampleRate: sampleRate, memory: new Array(65536).fill(0) });
          this.ready = true;
          this.port.postMessage({ type: 'ready', payload: { sampleRate, blockSize: 128 } });
        } catch (e) {
          this.port.postMessage({ type: 'error', payload: String(e) });
        }
      } else if (type === 'loadPattern') {
        // GT2 order list mode (only mode)
        this.allPatterns = payload.allPatterns || [];
        this.orderLists = payload.orderLists || [[0], [0], [0]];
        this.patternRows = [0, 0, 0];
        this.instruments = payload.instruments || [];
        if (payload.tables) {
          this.tables = payload.tables;
        }
        this.isGT2 = true; // Flag to enforce GT2 timing logic

        // Initialize order positions to start of each orderlist
        this.orderPositions = [0, 0, 0];
        for (let voice = 0; voice < 3; voice++) {
          this.voiceState[voice].transpose = 0;
        }

        // Debug what we received
        console.log('Worklet: Loaded GT2 song');
        console.log('  Patterns:', this.allPatterns.length);
        console.log('  Order lists:', this.orderLists.map((ol, i) => `V${i}:[${ol.slice(0, 5).join(',')}...]`).join(' '));

        // Check first pattern for EACH voice based on their order lists
        for (let voice = 0; voice < 3; voice++) {
          const orderList = this.orderLists[voice] || [];
          const firstPatternIdx = orderList[0];
          if (firstPatternIdx !== undefined && firstPatternIdx < this.allPatterns.length) {
            const pattern = this.allPatterns[firstPatternIdx];
            console.log(`  Voice ${voice} starts with pattern ${firstPatternIdx} (${pattern ? pattern.length : 0} rows):`);
            if (pattern) {
              for (let row = 0; row < Math.min(5, pattern.length); row++) {
                const r = pattern[row];
                const noteHex = r && r.note !== undefined ? `0x${r.note.toString(16)}` : 'undef';
                const noteType = r ? (r.note === 0 ? 'EMPTY' : r.note === 0xBD ? 'REST' : r.note >= 0x60 && r.note <= 0xBC ? 'NOTE' : 'OTHER') : '???';
                console.log(`    Row ${row}: note=${r?.note} (${noteHex}) ${noteType}, inst=${r?.instrument}`);
              }
            }
          } else {
            console.log(`  Voice ${voice}: pattern ${firstPatternIdx} NOT FOUND in allPatterns`);
          }
        }
      } else if (type === 'setBPM') {
        if (!this.isGT2) {
          this.bpm = Math.max(30, Math.min(300, payload.bpm || 120));
          this.stepDurationSamples = (sampleRate * 60) / (this.bpm * 4);
        }
      } else if (type === 'setGT2Tempo') {
        if (payload.speed > 0) {
          this.globalTempo = payload.speed;
          if (this.isGT2) this.stepDurationSamples = this.globalTempo * this.tickIntervalSamples;
        }
        if (payload.tempo > 0 && payload.tempo !== payload.speed) {
          this.funktempo = { active: true, left: payload.speed, right: payload.tempo, state: 0 };
        } else {
          this.funktempo = { active: false };
        }
        console.log(`Worklet: setGT2Tempo Speed=${this.globalTempo}, Tempo=${payload.tempo} (Dur=${this.stepDurationSamples})`);
      } else if (type === 'updateInstruments') {
        // Replace instruments array on the fly for live GT2 playback
        this.instruments = payload && payload.instruments ? payload.instruments : this.instruments;
      } else if (type === 'start') {
        this.currentStep = 0;

        if (this.isGT2) {
          // GT2 Mode: Initial duration based on Default Tempo (Speed 6)
          // Ensure tickInterval is set (in case sampleRate changed, though unlikely)
          this.tickIntervalSamples = Math.floor(sampleRate / 50);
          const initialTicks = this.globalTempo || 6;
          this.stepDurationSamples = initialTicks * this.tickIntervalSamples;
        } else {
          // Standard Mode: BPM based
          this.stepDurationSamples = (sampleRate * 60) / (this.bpm * 4);
        }

        // Ensure volume is set to max (panic may have cleared it)
        const currentFilter = this.regs[24] & 0xF0; // Preserve filter settings
        this.poke(24, currentFilter | 0x0F); // Set volume to max (0x0F)

        // Debug: log mute state at start
        console.log('Worklet start - mute state:', this.voiceState.map((v, i) => `V${i}:${v.muted}`).join(' '));
        // Clear any leftover gate-ons from previous playback BEFORE triggering first step
        this.pendingGateOns.length = 0;
        // Reset debug counters for new playback session
        this.bufferDebugCount = 0;
        this.genDebugCount = 0;
        this.tickDebugCount = 0;
        // Trigger first step immediately, then schedule subsequent steps
        try { this.handleSequencerStep(this.sampleCounter); } catch (_) { }
        this.nextStepSample = this.sampleCounter + this.stepDurationSamples;
        this.nextTickSample = this.sampleCounter + this.tickIntervalSamples; // Start tick timer for commands
        this.port.postMessage({ type: 'started' });
      } else if (type === 'stop') {
        this.nextStepSample = 0;
        this.nextTickSample = 0;
        this.pendingGateOns.length = 0;
        // Clear realtime command state
        for (let v = 0; v < 3; v++) {
          if (this.voiceState[v]) {
            this.voiceState[v].activeCommand = 0;
            this.voiceState[v].commandData = 0;
          }
        }
        this.port.postMessage({ type: 'stopped' });
      } else if (type === 'panic') {
        // Hard stop: clear sequencer timing and mute output
        this.nextStepSample = 0;
        this.nextTickSample = 0;
        this.pendingGateOns.length = 0;
        // Clear gates and frequencies
        for (let v = 0; v < 3; v++) {
          this.setVoiceReg(v, 0x04, 0x00);
          this.setVoiceReg(v, 0x00, 0x00);
          this.setVoiceReg(v, 0x01, 0x00);
        }
        // Mute master volume
        this.poke(24, (this.regs[24] & 0xF0) | 0x00);
        // Clear voice states
        for (let v = 0; v < 3; v++) {
          const vs = this.voiceState[v];
          if (vs) { vs.active = false; vs.releaseUntilSample = 0; }
        }
        this.port.postMessage({ type: 'stopped' });
      } else if (type === 'setDebug') {
        this.debug = !!(payload && payload.enabled);
      } else if (type === 'muteVoice') {
        const voice = event.data.voice;
        if (voice >= 0 && voice < 3) {
          this.voiceState[voice].muted = true;
          // Immediately clear gate for this voice
          this.setVoiceReg(voice, 0x04, 0x00);
        }
      } else if (type === 'unmuteVoice') {
        const voice = event.data.voice;
        if (voice >= 0 && voice < 3) {
          this.voiceState[voice].muted = false;
        }
      } else if (type === 'poke') {
        if (this.synth) {
          const { address, value } = payload;
          // Debug waveform register pokes
          const reg = address % 7;
          if (reg === 4) {
            const voice = Math.floor(address / 7);
            console.log(`📥 Worklet poke: addr=0x${address.toString(16)}, voice=${voice}, reg=${reg}, value=0x${value.toString(16)}`);
          }
          this.synth.poke(address >>> 0, value & 0xFF);
          const idx = address & 0x1F;
          this.regs[idx] = value & 0xFF;
        }
      } else if (type === 'noteOn') {
        if (this.synth) {
          const { voice, frequencyHz, instrument } = payload;
          const sidFreq = this.hzToSid(frequencyHz);
          this.setVoiceReg(voice, 0x00, sidFreq & 0xFF);
          this.setVoiceReg(voice, 0x01, (sidFreq >> 8) & 0xFF);
          const pw = (instrument.pulseWidth | 0) & 0x0FFF;
          this.setVoiceReg(voice, 0x02, pw & 0xFF);
          this.setVoiceReg(voice, 0x03, (pw >> 8) & 0xFF);
          this.setVoiceReg(voice, 0x05, instrument.ad & 0xFF);
          this.setVoiceReg(voice, 0x06, instrument.sr & 0xFF);
          this.applyFilterIfNeeded(voice, instrument);
          this.setVoiceReg(voice, 0x04, 0x00);
          let control = (instrument.waveform & 0xF0) | 0x01;
          if (instrument.sync) control |= 0x02;
          if (instrument.ringMod) control |= 0x04;
          // For GT2 tables, set initial waveform then let table engine take over
          // GT2 uses 1-based pointers: 0 = no table, 1+ = table position
          const hasWavetable = instrument.tables && instrument.tables.wave > 0;
          if (hasWavetable) {
            // Set instrument waveform+gate immediately, table will update it on first tick
            this.setVoiceReg(voice, 0x04, control);
          } else {
            // Normal instrument: schedule gate-on with full waveform
            this.pendingGateOns.push({ sample: this.sampleCounter + this.retriggerGap, voice, value: control });
          }
          // Track voice state for GT2 playback
          const vs = this.voiceState[voice];
          vs.active = true;
          vs.instrument = instrument;
          vs.instrumentIndex = (payload && typeof payload.instrumentIndex === 'number') ? payload.instrumentIndex : -1;
          vs.baseHz = frequencyHz;
          vs.basePW = pw;
        }
      } else if (type === 'noteOff') {
        if (this.synth) {
          const { voice, waveform } = payload;
          const w = (waveform & 0xF0) & 0xFE;
          this.setVoiceReg(voice, 0x04, w);
          const vs = this.voiceState[voice];
          if (vs) {
            // Track release for ADSR envelope completion
            const inst = (vs.instrumentIndex >= 0 && this.instruments[vs.instrumentIndex]) ? this.instruments[vs.instrumentIndex] : vs.instrument;
            const rel = this.estimateReleaseSamples(inst);
            vs.releaseUntilSample = this.sampleCounter + rel;
            // Treat as still active during release
            vs.active = true;
          }
        }
      }
    };
  }

  // Process GT2 orderlist commands to find pattern and transpose
  processOrderlistCommands(orderList, startPos) {
    const MAX_PATTERNS = 208;
    let pos = startPos;
    let transpose = 0;

    while (pos < orderList.length) {
      const entry = orderList[pos];

      // 0xFF = ENDSONG, 0xFE = LOOPSONG - can't start here
      if (entry === 0xFF || entry === 0xFE) {
        return { patternIndex: 0, transpose: 0, nextPosition: 0 };
      }
      // 0xD0-0xDF = REPEAT command (skip command and parameter)
      else if (entry >= 0xD0 && entry <= 0xDF) {
        pos += 2; // Skip command and parameter byte
      }
      // 0xE0-0xEE = Transpose UP (+0 to +14 halftones)
      else if (entry >= 0xE0 && entry <= 0xEE) {
        transpose += (entry - 0xE0);
        pos++;
      }
      // 0xEF-0xFD = Transpose DOWN (-1 to -15 halftones)
      else if (entry >= 0xEF && entry <= 0xFD) {
        transpose -= (entry - 0xEE);
        pos++;
      }
      // Pattern number
      else if (entry < MAX_PATTERNS) {
        return { patternIndex: entry, transpose, nextPosition: pos };
      }
      // Unknown - skip
      else {
        pos++;
      }
    }

    // Reached end without finding pattern
    return { patternIndex: 0, transpose: 0, nextPosition: 0 };
  }

  noteToHz(note, transpose = 0) {
    if (!note || note === 'R' || note === '---' || note === 0xBD || note === 0xBE || note === 0xFE || note === 0xFF || note === 254 || note === 255 || note === 0) return 0;

    let midiNote;
    if (typeof note === 'number') {
      if (note >= 0x60) {
        // Raw GT2 bytes: 0x60 (96) = C-0 (MIDI 12)
        midiNote = (note - 0x60) + 12 + transpose;
      } else {
        // Legacy mapping: note 48 = C-4 = MIDI 60, so offset = 12
        midiNote = note + 12 + transpose;
      }
    } else {
      const n = note.toUpperCase();
      const match = n.match(/^([A-G])(#?)(-?)(\d)$/);
      if (!match) return 0;

      const [, noteName, sharp, , octave] = match;
      const noteMap = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
      const noteInOctave = noteMap[noteName] + (sharp ? 1 : 0);
      midiNote = (parseInt(octave) + 1) * 12 + noteInOctave + transpose;
    }

    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    return freq;
  }

  hzToSid(f) {
    const clock = 985248;
    const v = Math.round((f * 16777216) / clock);
    return Math.max(0, Math.min(65535, v));
  }

  poke(address, value) {
    this.synth.poke(address & 0xFFFF, value & 0xFF);
    this.regs[address & 0x1F] = value & 0xFF;
  }

  setVoiceReg(voice, reg, value) {
    const VOFF = 0x07;
    this.poke(voice * VOFF + reg, value);
  }

  applyFilterIfNeeded(voice, inst) {
    if (!inst || !inst.filter || !inst.filter.enabled) return;
    const freq = inst.filter.frequency | 0;
    const ffreqlo = freq & 0x07;
    const ffreqhi = (freq >> 3) & 0xFF;
    this.poke(21, ffreqlo);
    this.poke(22, ffreqhi);
    const resonance = (inst.filter.resonance & 0xF0);
    const currentRouting = this.regs[23] & 0x07;
    const routing = currentRouting | (1 << voice);
    this.poke(23, resonance | routing);
    const currentVolume = this.regs[24] & 0x0F;
    const volume = currentVolume === 0 ? 0x0F : currentVolume;
    const type = inst.filter.type & 0x70;
    this.poke(24, type | volume);
  }

  // Estimate a simple release time in samples based on instrument.sr low nibble
  estimateReleaseSamples(inst) {
    const rNib = (inst && typeof inst.sr === 'number') ? (inst.sr & 0x0F) : 0;
    const ms = Math.max(80, rNib * 70); // coarse but effective
    return Math.floor((ms / 1000) * sampleRate);
  }

  // Execute realtime commands (1-4) on each tick for smooth modulation
  executeRealtimeCommands_OLD() {
    for (let voice = 0; voice < 3; voice++) {
      const vs = this.voiceState[voice];

      // Skip if no active realtime command or voice not active
      if (vs.activeCommand < 1 || vs.activeCommand > 4) continue;

      // Data from speedtable
      const cmd = vs.activeCommand;
      const index = vs.commandData;

      let freqChange = 0;
      let updateFreq = false;

      // Command 1: Portamento Up
      if (cmd === 0x1) {
        const speed = this.readSpeedtable16bit(index);
        if (speed > 0) {
          vs.currentFrequency += speed;
          updateFreq = true;
        }
      }
      // Command 2: Portamento Down
      else if (cmd === 0x2) {
        const speed = this.readSpeedtable16bit(index);
        if (speed > 0) {
          vs.currentFrequency -= speed;
          updateFreq = true;
        }
      }
      // Command 3: Toneportamento
      else if (cmd === 0x3) {
        const speed = this.readSpeedtable16bit(index);
        if (speed > 0) {
          if (vs.currentFrequency < vs.targetFrequency) {
            vs.currentFrequency += speed;
            if (vs.currentFrequency > vs.targetFrequency) vs.currentFrequency = vs.targetFrequency;
          } else if (vs.currentFrequency > vs.targetFrequency) {
            vs.currentFrequency -= speed;
            if (vs.currentFrequency < vs.targetFrequency) vs.currentFrequency = vs.targetFrequency;
          }
          updateFreq = true;
        }
      }
      // Command 4: Vibrato
      else if (cmd === 0x4) {
        const entry = this.readSpeedtableDual(index);
        const speed = entry.left;
        const depth = entry.right;

        if (speed > 0 && depth > 0) {
          vs.vibratoPhase = (vs.vibratoPhase + speed) & 0xFF; // Wrap?
          // GT2 Vibrato is simple: add/sub based on phase direction
          // Usually it's a triangle wave or square wave.
          // GT2: phase goes 0..speed? No, looking at player.s:
          // It adds 2 to phase? "adc #$02" line 396?
          // Actually my JS implementation used a direction toggle.
          // Let's stick to the JS logic I verified earlier:
          vs.vibratoPhase++;
          if (vs.vibratoPhase >= speed) {
            vs.vibratoPhase = 0;
            vs.vibratoDirection = -vs.vibratoDirection;
          }

          // Apply depth * direction
          // Note: Vibrato modulates AROUND the base note. 
          // So we need to set freq = baseFrequency + (depth * dir)
          // But baseFrequency might be sliding if Toneporta is active? 
          // No, 4xx and 3xx are mutually exclusive in `activeCommand`.

          // Current implementation modifies `currentFrequency` directly?
          // If we modify `currentFrequency`, it drifts.
          // We should calculate `modFreq` from `currentFrequency` without writing back?
          // Or use `baseFrequency`?
          // Since `currentFrequency` is used for 1xx/2xx accumulation, using it as base is risky if we add/sub asymmetrically.
          // However, 1xx/2xx update `currentFrequency` permanently.
          // 4xx should optionally oscillate around it.

          // For now, let's just calculate a temporary frequency for the poke
          const mod = depth * vs.vibratoDirection;
          // We don't update vs.currentFrequency permanently, we just POKE the modulated value.
          // BUT, if we want to support 1xx + 4xx (not possible with one cmd),
          // wait, GT2 has only one command per row.

          // Poke the modulated frequency
          const finalFreq = Math.max(0, Math.min(65535, vs.currentFrequency + mod));
          this.setVoiceReg(voice, 0x00, finalFreq & 0xFF);
          this.setVoiceReg(voice, 0x01, (finalFreq >> 8) & 0xFF);

          continue; // Done for this voice
        }
      }

      if (updateFreq) {
        // Clamp and write
        vs.currentFrequency = Math.max(0, Math.min(65535, vs.currentFrequency));
        this.setVoiceReg(voice, 0x00, vs.currentFrequency & 0xFF);
        this.setVoiceReg(voice, 0x01, (vs.currentFrequency >> 8) & 0xFF);
      }
    }
  }

  handleSequencerStep(eventSample) {
    // Capture positions BEFORE advancing for UI highlighting
    const playingPositions = [];

    for (let voice = 0; voice < 3; voice++) {
      // Skip if voice is muted
      if (this.voiceState[voice].muted) {
        playingPositions.push(null);
        continue;
      }

      // GT2 order list mode - process commands to get current pattern
      const orderList = this.orderLists[voice];
      const orderPos = this.orderPositions[voice];
      const vs = this.voiceState[voice];

      // Process commands from current position to get pattern and transpose
      const result = this.processOrderlistCommands(orderList, orderPos);
      const patternIndex = result.patternIndex;

      // Update transpose (don't update orderPosition yet - that happens when pattern ends)
      vs.transpose = result.transpose;

      if (patternIndex >= this.allPatterns.length || patternIndex === 0xFF) {
        // End of song or invalid pattern
        playingPositions.push(null);
        continue;
      }

      const pattern = this.allPatterns[patternIndex];
      const row = this.patternRows[voice];

      // Save the position being played NOW (before advancing)
      playingPositions.push({
        orderPos: orderPos,
        patternIndex: patternIndex,
        patternRow: row
      });

      const step = pattern[row] || { note: '', instrument: 0, command: 0, cmdData: 0 };

      // Debug: log step data for all voices at row 0 AND for voices 1,2 on any note
      if (this.debug && row === 0) {
        console.log(`📊 V${voice} row=${row}: note=${step.note} (0x${(step.note||0).toString(16)}), inst=${step.instrument}, patternIdx=${patternIndex}, pattern.length=${pattern.length}`);
      }
      // Extra debug for voices 1 and 2 (index 1 and 2) - show all notes
      if (this.debug && (voice === 1 || voice === 2) && step.note >= 0x60 && step.note <= 0xBC) {
        console.log(`🎵 V${voice} row=${row}: NOTE 0x${step.note.toString(16)}, inst=${step.instrument}`);
      }

      // Execute pattern command if present
      if (step.command && step.command > 0) {
        // Store realtime command state (1-4) for continuous execution
        if (step.command >= 1 && step.command <= 4) {
          vs.activeCommand = step.command;
          vs.commandData = step.cmdData;
        } else if (step.command === 0) {
          // Command 0 stops realtime effects
          vs.activeCommand = 0;
          vs.commandData = 0;
          vs.vibratoPhase = 0; // Reset vibrato phase
        } else if (step.command === 0x0F) {
          // Set Tempo (Ticks per Row)
          if (step.cmdData < 0x80) {
            this.globalTempo = step.cmdData;
            this.stepDurationSamples = this.globalTempo * this.tickIntervalSamples;
          }
        } else if (step.command === 0x0E) {
          // Funktempo (Swing)
          if (step.cmdData === 0) {
            this.funktempo = { active: false };
          } else {
            const entry = this.readSpeedtableDual(step.cmdData);
            this.funktempo = { active: true, left: entry.left, right: entry.right, state: 0 };
          }
        }

        // Note: Command 3 (Toneportamento) setup happens below with Note
      }

      // Advance pattern row
      this.patternRows[voice]++;
      if (this.patternRows[voice] >= pattern.length) {
        // Pattern ended, advance order list to next entry after current pattern
        this.patternRows[voice] = 0;
        this.orderPositions[voice] = result.nextPosition + 1;

        // Check for special commands at new position
        if (this.orderPositions[voice] >= orderList.length) {
          // End of orderlist - loop to start
          this.orderPositions[voice] = 0;
        } else {
          const nextEntry = orderList[this.orderPositions[voice]];
          if (nextEntry === 0xFF) {
            // ENDSONG - loop to start
            this.orderPositions[voice] = 0;
          } else if (nextEntry === 0xFE) {
            // LOOPSONG - jump to specified position
            const loopPos = orderList[this.orderPositions[voice] + 1] || 0;
            this.orderPositions[voice] = loopPos;
          }
        }
      }

      // Handle Note / Instrument / Gate
      const noteInput = step.note;
      // GT2 file format (from official readme.txt section 6.1.6):
      //   $00       = empty (no note data - sustain)
      //   $60-$BC   = notes C-0 to G#7
      //   $BD (189) = REST ("...") - SUSTAIN previous note, NO gate change!
      //   $BE (190) = KEYOFF ("---") - clear gate bit, trigger ADSR release
      //   $BF (191) = KEYON ("+++") - set gate bit (re-trigger without new note)
      //   $FF       = pattern end
      // Internal format: 0=empty, 254=REST (legacy), 255=KEYOFF (legacy)
      const isSustain = (noteInput === 0 || noteInput === 0xBD || noteInput === 189);
      const isKeyOn = (noteInput === 0xBF || noteInput === 191);
      const isRelease = (noteInput === 0xBE || noteInput === 190 || noteInput === 254 || noteInput === 0xFE || noteInput === 255 || noteInput === 0xFF);

      if (isSustain) {
        // REST / Sustain - No gate change, no frequency change, keep playing
      } else if (isKeyOn) {
        // KEYON ("+++") - Set gate bit (re-trigger attack without changing frequency)
        vs.gate = 0xFF; // Gate on mask
        const gateOnVal = vs.wave | 0x01;  // Ensure gate bit is set
        console.log(`🔔 V${voice} @${this.sampleCounter} KEYON: wave=0x${vs.wave.toString(16)} → reg=0x${gateOnVal.toString(16)}`);
        this.setVoiceReg(voice, 0x04, gateOnVal);
      } else if (isRelease) {
        // KEYOFF ("---") - GT2 style: set gate = 0xFE and write immediately
        vs.gate = 0xFE; // Gate off mask
        // Write waveform with gate cleared to SID register NOW
        const gateOffVal = vs.wave & vs.gate;
        console.log(`🔕 V${voice} @${this.sampleCounter} KEYOFF: wave=0x${vs.wave.toString(16)} → reg=0x${gateOffVal.toString(16)}`);
        this.setVoiceReg(voice, 0x04, gateOffVal);
        const inst = this.instruments[step.instrument | 0] || vs.instrument || null;
        if (vs) {
          const rel = this.estimateReleaseSamples(inst);
          vs.releaseUntilSample = this.sampleCounter + rel;
          vs.active = true;
        }
      } else {
        // Normal Note
        const freqHz = this.noteToHz(noteInput, vs.transpose);
        // GT2: instrument 0 = "no change" (use current), 1+ = actual instrument
        const instNum = step.instrument | 0;
        const inst = (instNum > 0) ? (this.instruments[instNum] || vs.instrument) : vs.instrument;

        if (!inst) {
          // No instrument at all, skip
        } else if (freqHz) {
          // Trigger GT2 frame engine tables if instrument has them
          // GT2 uses 1-based pointers: 0 = no table, 1+ = table position

          // Simple GT2 style: set waveform with gate bit
          vs.wave = (inst.waveform & 0xF0) | 0x01;  // Waveform WITH gate bit
          if (inst.sync) vs.wave |= 0x02;
          if (inst.ringMod) vs.wave |= 0x04;

          // GT2 Hard Restart: gate OFF for first few frames to allow ADSR attack
          // This prevents wavetable from immediately overwriting the gate bit
          const gateTimer = inst.gateTimer || 2;  // Default 2 frames if not specified
          if (gateTimer > 0) {
            vs.hrTimer = gateTimer;
            vs.gate = 0xFE;  // Gate mask clears bit 0 during HR
          } else {
            vs.hrTimer = 0;
            vs.gate = 0xFF;
          }

          // ALWAYS reset table state when a new note triggers
          vs.ptr = [0, 0, 0, 0]; // [Wave, Pulse, Filter, Speed]
          vs.waveActive = false;
          vs.pulseActive = false;
          vs.filterActive = false;
          vs.speedActive = false;
          vs.wavetime = 0;
          vs.pulsetime = 0;
          vs.filtertime = 0;
          vs.speedtime = 0;
          vs.tableNote = 0;
          vs.pulseModTicks = 0;
          vs.pulseModSpeed = 0;
          vs.filterModTicks = 0;
          vs.filterModSpeed = 0;
          vs.baseNote = (typeof noteInput === 'number') ? noteInput : this.getMidiNote(noteInput);

          // Initialize tables if instrument has them (1-based pointers, 0 = no table)
          if (inst.tables) {
            const t = inst.tables;
            if (t.wave > 0) {
              vs.ptr[0] = t.wave;
              vs.waveActive = true;
            }
            if (t.pulse > 0) {
              vs.ptr[1] = t.pulse;
              vs.pulseActive = true;
              vs.tablePulse = vs.basePW || 0x800;
            }
            if (t.filter > 0) {
              vs.ptr[2] = t.filter;
              vs.filterActive = true;
            }
            if (t.speed > 0) {
              vs.ptr[3] = t.speed;
              vs.speedActive = true;
            }
          }

          const sidFreq = this.hzToSid(freqHz);

          // Handle Toneportamento (Command 3)
          if (vs.activeCommand === 0x3 && vs.commandData > 0) {
            vs.targetFrequency = sidFreq;
          } else {
            // Normal Note: Jump frequency immediately
            this.setVoiceReg(voice, 0x00, sidFreq & 0xFF);
            this.setVoiceReg(voice, 0x01, (sidFreq >> 8) & 0xFF);
            vs.currentFrequency = sidFreq;
            vs.baseSidFreq = sidFreq; // Store base for Arpeggio resets

            // Trigger Gate / ADSR / Pulse / etc.
            const pw = inst.pulseWidth | 0;
            // Ensure ADSR values are defined and non-zero (0x00 = instant attack/decay/sustain/release = silent)
            const ad = (inst.ad !== undefined && inst.ad !== null) ? (inst.ad & 0xFF) : 0x0F;  // Default: fast attack, moderate decay
            const sr = (inst.sr !== undefined && inst.sr !== null) ? (inst.sr & 0xFF) : 0xF0;  // Default: high sustain, slow release

            this.setVoiceReg(voice, 0x02, pw & 0xFF);
            this.setVoiceReg(voice, 0x03, (pw >> 8) & 0xFF);
            this.setVoiceReg(voice, 0x05, ad);
            this.setVoiceReg(voice, 0x06, sr);

            // DEBUG: Show all critical SID register values with timing
            console.log(`🔧 V${voice} @${this.sampleCounter} REGISTERS: freq=${sidFreq}, AD=0x${ad.toString(16).padStart(2,'0')}, SR=0x${sr.toString(16).padStart(2,'0')}, wave=0x${vs.wave.toString(16)}`);

            this.applyFilterIfNeeded(voice, inst);

            // Write waveform with current gate mask (0xFE during HR, 0xFF after)
            // During hard restart, gate bit is cleared to allow ADSR attack phase
            vs.pendingGateOn = false;
            const gateOnVal = vs.wave & vs.gate;
            this.setVoiceReg(voice, 0x04, gateOnVal);
            console.log(`🎹 V${voice} @${this.sampleCounter} NOTE-ON: wave=0x${vs.wave.toString(16)}, gate=0x${vs.gate.toString(16)}, reg=0x${gateOnVal.toString(16)}, hrTimer=${vs.hrTimer}`);
            if (this.debug) {
              console.log(`🎵 V${voice} NOTE: inst=${instNum}, vs.wave=0x${vs.wave.toString(16)}, tables=${inst.tables ? `W${inst.tables.wave}/P${inst.tables.pulse}` : 'none'}, waveActive=${vs.waveActive}`);
              // Debug: Print wavetable contents at the instrument's wave pointer
              if (inst.tables && inst.tables.wave > 0) {
                const wavePtr = inst.tables.wave;
                const TABLE_WAVE = 0;
                console.log(`📊 V${voice} WTBL contents starting at ptr=${wavePtr}:`);
                for (let i = 0; i < 8; i++) {
                  const pos = wavePtr + i;
                  const left = this.tables.ltable[TABLE_WAVE][pos - 1] || 0;
                  const right = this.tables.rtable[TABLE_WAVE][pos - 1] || 0;
                  const isDelay = left <= 0x0F;
                  const isWaveform = left >= 0x10 && left < 0xE0;
                  const isJump = left === 0xFF;
                  const hasGate = (left & 0x01) !== 0;
                  console.log(`  [${pos}] L=0x${left.toString(16).padStart(2,'0')} R=0x${right.toString(16).padStart(2,'0')} | ${isDelay ? `DELAY ${left}` : isWaveform ? `WAVE ${hasGate ? '+gate' : 'NO-gate'}` : isJump ? `JUMP→${right}` : 'CMD'}`);
                  if (isJump) break; // Stop at jump
                }
              }
            }
          }

          // Update voice state for GT2 playback
          vs.active = true;
          vs.instrument = inst;
          vs.instrumentIndex = instNum; // 0 = no change, 1+ = instrument number
          vs.baseHz = freqHz;
          vs.basePW = (inst.pulseWidth | 0);
          vs.releaseUntilSample = 0;
        }
      }
    } // End of voice loop

    // === STEP-LEVEL OPERATIONS (once per step, not per voice) ===

    // In GT2 mode, there's no single pattern length (each voice has different patterns)
    // Just keep incrementing for timing purposes
    this.currentStep = this.currentStep + 1;

    // Update timing for NEXT step based on current Tempo/Funktempo
    let ticks = this.globalTempo || 6;
    if (this.funktempo && this.funktempo.active) {
      let ftVal = (this.funktempo.state === 0) ? this.funktempo.left : this.funktempo.right;
      // If funktempo value is invalid (0), ignore it and use global tempo
      if (ftVal > 0) {
        ticks = ftVal;
      }
      // Toggle state for next step (alternates between left and right tempo)
      this.funktempo.state ^= 1;
    }
    // Safety: Ticks must be at least 1 to prevent infinite loops/super-fast playback
    ticks = Math.max(1, ticks);

    // Send detailed position info for UI highlighting (positions that were JUST PLAYED)
    this.port.postMessage({
      type: 'step',
      payload: {
        step: this.currentStep,
        ticks: ticks,
        globalTempo: this.globalTempo || 6,
        isGT2: this.isGT2,
        // Per-voice positions for track view highlighting (row that just played, not next row)
        voicePositions: playingPositions
      }
    });

    this.stepDurationSamples = ticks * this.tickIntervalSamples;
    if (this.debug && this.currentStep % 16 === 0) {
      console.log(`Step ${this.currentStep}: Tempo=${this.globalTempo}, Ticks=${ticks}, Dur=${this.stepDurationSamples}`);
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const right = output[1] || output[0];
    const frames = left.length;
    if (!this.ready || !this.synth) {
      for (let i = 0; i < frames; i++) { left[i] = 0; right[i] = 0; }
      return true;
    }
    const bufferStart = this.sampleCounter;
    const bufferEnd = bufferStart + frames;
    const events = [];
    while (this.nextStepSample > 0 && this.nextStepSample >= bufferStart && this.nextStepSample < bufferEnd) {
      events.push({ type: 'seq', offset: this.nextStepSample - bufferStart });
      this.nextStepSample += this.stepDurationSamples;
    }
    // REMOVED: Old LFO event scheduling - GT2 uses tables at 50Hz tick rate instead
    // Schedule tick events for realtime command execution (50Hz)
    if (!this.nextTickSample) this.nextTickSample = 0;
    while (this.nextTickSample > 0 && this.nextTickSample >= bufferStart && this.nextTickSample < bufferEnd) {
      events.push({ type: 'tick', offset: this.nextTickSample - bufferStart });
      this.nextTickSample += this.tickIntervalSamples;
    }
    const remainGate = [];
    for (let i = 0; i < this.pendingGateOns.length; i++) {
      const ge = this.pendingGateOns[i];
      if (ge.sample >= bufferStart && ge.sample < bufferEnd) {
        events.push({ type: 'gateOn', offset: ge.sample - bufferStart, voice: ge.voice, value: ge.value });
      } else if (ge.sample >= bufferEnd) {
        remainGate.push(ge);
      }
    }
    this.pendingGateOns = remainGate;
    events.sort((a, b) => a.offset - b.offset);
    // Debug: show buffer boundaries and events (UNCONDITIONAL for first 30 buffers with events)
    if (this.bufferDebugCount === undefined) this.bufferDebugCount = 0;
    if (this.bufferDebugCount < 30 && events.length > 0) {
      console.log(`📦 Buffer @${bufferStart}-${bufferEnd} (${frames} frames), events=${events.length}, nextTick=${this.nextTickSample}, debug=${this.debug}`);
      console.log(`  Events: ${events.map(e => `${e.type}@${e.offset}`).join(', ')}`);
      this.bufferDebugCount++;
    }
    let writeIndex = 0;
    const writeChunk = (chunk, start) => {
      for (let i = 0; i < chunk.length; i++) { left[start + i] = chunk[i]; right[start + i] = chunk[i]; }
    };
    let idx = 0;
    let genCount = 0;
    while (idx < events.length) {
      const off = events[idx].offset | 0;
      const len = Math.max(0, off - writeIndex);
      if (len > 0) {
        const chunk = this.synth.generate(len);
        writeChunk(chunk, writeIndex);
        // Check for non-silent audio (first 50 GEN calls when there are events)
        if (this.debug && this.genDebugCount === undefined) this.genDebugCount = 0;
        if (this.debug && this.genDebugCount < 50) {
          const maxSample = Math.max(...chunk.map(Math.abs));
          const vol = this.regs[24] & 0x0F;
          console.log(`  🔈 GEN ${len} samples @${this.sampleCounter + writeIndex}, maxAmp=${maxSample.toFixed(4)}, vol=${vol}, regs4=[${this.regs[4].toString(16)},${this.regs[11].toString(16)},${this.regs[18].toString(16)}]`);
          this.genDebugCount++;
        }
        writeIndex += len;
        genCount++;
      }
      while (idx < events.length && events[idx].offset === off) {
        const ev = events[idx++];
        if (ev.type === 'seq') this.handleSequencerStep(bufferStart + off);
        else if (ev.type === 'tick') {
          // Debug: log tick processing with timing (UNCONDITIONAL for first 20)
          if (this.tickDebugCount === undefined) this.tickDebugCount = 0;
          if (this.tickDebugCount < 20) {
            console.log(`⏱️ TICK @${bufferStart + off}, buffer=[${bufferStart}-${bufferEnd}], genCount=${genCount}, writeIndex=${writeIndex}, debug=${this.debug}`);
            this.tickDebugCount++;
          }
          this.executeRealtimeCommands();
          // Telemetry for Oscilloscope (50Hz)
          this.port.postMessage({
            type: 'telemetry',
            payload: {
              regs: Array.from(this.regs),
              sampleCounter: this.sampleCounter + off,
              filterConfig: {
                res: (this.regs[0x17] >> 4) & 0x0F,
                type: (this.regs[0x18] >> 4) & 0x07 // LP: 0x10, BP: 0x20, HP: 0x40
              }
            }
          });
        }
        else if (ev.type === 'gateOn') {
          // GT2-style gate-on: set gate mask back to 0xFF and write current wave
          const vs = this.voiceState[ev.voice];
          if (vs) {
            vs.gate = 0xFF;  // GT2: cptr->gate = 0xff (pass all bits)
            vs.pendingGateOn = false;
            // Write current wave with gate enabled (wave & 0xFF = wave with gate bit)
            const val = vs.wave & vs.gate;
            if (this.debug) {
              console.log(`🎹 V${ev.voice} GATE-ON: vs.wave=0x${vs.wave.toString(16)}, gate=0x${vs.gate.toString(16)}, reg=0x${val.toString(16)}, hasGate=${(val & 0x01) !== 0}`);
            }
            this.poke(ev.voice * 0x07 + 0x04, val);
          } else {
            // Fallback for edge case
            this.poke(ev.voice * 0x07 + 0x04, ev.value & 0xFF);
          }
        }
      }
    }
    const remaining = frames - writeIndex;
    if (remaining > 0) { const tail = this.synth.generate(remaining); writeChunk(tail, writeIndex); }
    this.sampleCounter += frames;
    return true;
  }

  // REMOVED: Old PWM LFO, FM LFO, and Arpeggio engines
  // GT2-only: Use PTBL for PWM, STBL+command 4XY for vibrato, WTBL for arpeggios

  // Helper: Read 16-bit value from speedtable (for portamento)
  // GT2 uses 1-based indices, reads with [param-1]
  readSpeedtable16bit(index) {
    if (index === 0) return 0;
    // ltable[3] is speedtable left, rtable[3] is speedtable right
    const left = this.tables.ltable[3][index - 1] || 0;
    const right = this.tables.rtable[3][index - 1] || 0;
    return (left << 8) | right;
  }

  // Helper: Read dual-byte value from speedtable (for vibrato)
  // GT2 uses 1-based indices, reads with [param-1]
  readSpeedtableDual(index) {
    if (index === 0) return { left: 0, right: 0 };
    if (!this.tables.ltable[3] || !this.tables.rtable[3]) return { left: 0, right: 0 };
    const left = this.tables.ltable[3][index - 1] || 0;
    const right = this.tables.rtable[3][index - 1] || 0;
    return { left, right };
  }

  // Execute wavetable step - EXACT GT2 gplay.c logic (lines 518-726)
  // GT2 constants: WAVELASTDELAY=0x0F, WAVESILENT=0xE0, WAVELASTSILENT=0xEF, WAVECMD=0xF0
  // Converted to iterative to prevent stack overflow on jump loops
  executeWavetable(voice) {
    const vs = this.voiceState[voice];
    const TABLE_WAVE = 0;
    const MAX_ITERATIONS = 16; // Prevent infinite loops

    if (!vs.waveActive || vs.ptr[TABLE_WAVE] === 0) return null;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const pos = vs.ptr[TABLE_WAVE];
      // GT2 uses 1-based pointers, reads with [ptr-1]
      const wave = this.tables.ltable[TABLE_WAVE][pos - 1] || 0;
      const note = this.tables.rtable[TABLE_WAVE][pos - 1] || 0;

      // Debug: Log first few wavetable reads per voice
      if (this.debug && vs.wavetime === 0 && pos <= 3) {
        console.log(`🎵 WTBL V${voice} pos=${pos}: wave=0x${wave.toString(16)}, note=0x${note.toString(16)}, hasGate=${(wave & 0x01) !== 0}`);
      }

      // GT2: if (wave > WAVELASTDELAY) - i.e., wave > 0x0F
      if (wave > 0x0F) {
        // Normal waveform values (0x10-0xDF)
        if (wave < 0xE0) {
          // WARNING: Check if gate bit is missing (bit 0 = 0)
          if ((wave & 0x01) === 0 && this.debug) {
            console.warn(`⚠️ V${voice} WTBL pos=${pos}: Waveform 0x${wave.toString(16)} has NO gate bit! Sound will release.`);
          }
          vs.wave = wave;  // Update vs.wave directly (GT2: cptr->wave = wave)
        }
        // Silent waveforms (0xE0-0xEF) - gate off with waveform
        else if (wave >= 0xE0 && wave <= 0xEF) {
          vs.wave = wave & 0x0F;  // GT2: cptr->wave = wave & 0xf
        }
        // Commands (0xF0-0xFE) - execute pattern command from wavetable
        else if (wave >= 0xF0 && wave <= 0xFE) {
          vs.wavetime = 0;
          vs.ptr[TABLE_WAVE]++;
          this.handleWavetableJump(vs, TABLE_WAVE);
          return { wave: vs.wave, note: vs.tableNote, noteChanged: false };
        }
        // Jump (0xFF) - loop instead of recursing
        else if (wave === 0xFF) {
          if (note === 0x00) {
            console.log(`🛑 V${voice} WTBL: Jump to 0 - STOPPING wavetable at pos=${pos}`);
            vs.waveActive = false;
            return null;
          }
          // Only log first few jumps per voice to avoid spam
          if (!this.jumpCount) this.jumpCount = [0, 0, 0];
          if (this.jumpCount[voice] < 5) {
            console.log(`🔄 V${voice} WTBL: Jump from pos ${pos} to ${note}, wavetime was ${vs.wavetime}`);
            this.jumpCount[voice]++;
          }
          vs.wavetime = 0;  // Reset wavetime on jump!
          vs.ptr[TABLE_WAVE] = note;
          continue; // Process new position in next iteration
        }
      } else {
        // Delay (0x00-0x0F)
        // GT2: if (cptr->wavetime != wave) { cptr->wavetime++; goto TICKNEFFECTS; }
        if (vs.wavetime !== wave) {
          vs.wavetime++;
          return { wave: vs.wave, note: vs.tableNote, noteChanged: false };
        }
        // Delay expired - fall through to advance pointer and process note
      }

      // GT2: cptr->wavetime = 0; cptr->ptr[WTBL]++;
      vs.wavetime = 0;
      vs.ptr[TABLE_WAVE]++;

      // GT2: Check for jump at new position and handle immediately
      if (this.handleWavetableJump(vs, TABLE_WAVE)) {
        continue; // Jump was taken, process new position
      }

      // GT2: Process note if != 0x80
      if (note !== 0x80) {
        if (note < 0x80) {
          vs.tableNote = note;
          return { wave: vs.wave, note: vs.tableNote, absolute: false, noteChanged: true };
        } else {
          vs.tableNote = note & 0x7F;
          return { wave: vs.wave, note: vs.tableNote, absolute: true, noteChanged: true };
        }
      }

      // Note == 0x80: keep frequency, only waveform may have changed
      return { wave: vs.wave, note: vs.tableNote, noteChanged: false };
    }

    // Safety: max iterations reached
    return { wave: vs.wave, note: vs.tableNote, noteChanged: false };
  }

  // Handle wavetable jump at current position - returns true if jump was taken
  handleWavetableJump(vs, TABLE_WAVE) {
    const pos = vs.ptr[TABLE_WAVE];
    // GT2 uses 1-based pointers, reads with [ptr-1]
    const nextWave = this.tables.ltable[TABLE_WAVE][pos - 1] || 0;
    if (nextWave === 0xFF) {
      const jumpTarget = this.tables.rtable[TABLE_WAVE][pos - 1] || 0;
      if (jumpTarget === 0x00) {
        console.log(`🔄 @${this.sampleCounter} WTBL handleJump: pos=${pos} jump to 0 - STOPPING`);
        vs.waveActive = false;
        return false;
      } else {
        console.log(`🔄 WTBL handleJump: pos=${pos} jumping to ${jumpTarget}`);
        vs.ptr[TABLE_WAVE] = jumpTarget;
        return true; // Jump was taken
      }
    }
    return false; // No jump
  }

  // Execute pulsetable step
  executePulsetable(voice) {
    const vs = this.voiceState[voice];
    const TABLE_PULSE = 1;

    if (!vs.pulseActive || vs.ptr[TABLE_PULSE] === 0) return vs.tablePulse;

    // Modulation
    if (vs.pulseModTicks > 0) {
      vs.pulseModTicks--;
      vs.tablePulse = (vs.tablePulse + vs.pulseModSpeed) & 0xFFF;
      return vs.tablePulse;
    }

    let jumpCount = 0;
    const MAX_JUMPS = 10;

    while (jumpCount < MAX_JUMPS) {
      const pos = vs.ptr[TABLE_PULSE];
      // GT2 uses 1-based pointers, reads with [ptr-1]
      const left = this.tables.ltable[TABLE_PULSE][pos - 1] || 0;
      const right = this.tables.rtable[TABLE_PULSE][pos - 1] || 0;

      // Modulation (0x01-0x7F)
      if (left >= 0x01 && left <= 0x7F) {
        vs.pulseModTicks = left;
        vs.pulseModSpeed = (right & 0x80) ? (right - 256) : right;
        vs.ptr[TABLE_PULSE]++;
        break;
      }
      // Set pulse (0x80-0xFE)
      else if (left >= 0x80 && left <= 0xFE) {
        const highNibble = (left & 0x0F) << 8;
        vs.tablePulse = highNibble | right;
        vs.ptr[TABLE_PULSE]++;
        break;
      }
      // Jump (0xFF)
      else if (left === 0xFF) {
        if (right === 0x00 || right >= 0xFF) {
          vs.pulseActive = false;
          break;
        }
        vs.ptr[TABLE_PULSE] = right;
        jumpCount++;
        continue;
      }
      else {
        vs.ptr[TABLE_PULSE]++;
        break;
      }
    }

    return vs.tablePulse;
  }

  // Execute filtertable step
  executeFiltertable(voice) {
    const vs = this.voiceState[voice];
    const TABLE_FILTER = 2;

    if (!vs.filterActive || vs.ptr[TABLE_FILTER] === 0) return vs.tableFilter;

    // Modulation
    if (vs.filterModTicks > 0) {
      vs.filterModTicks--;
      vs.tableFilter = Math.max(0, Math.min(0x7FF, vs.tableFilter + vs.filterModSpeed));
      return vs.tableFilter;
    }

    let jumpCount = 0;
    const MAX_JUMPS = 10;

    while (jumpCount < MAX_JUMPS) {
      const pos = vs.ptr[TABLE_FILTER];
      // GT2 uses 1-based pointers, reads with [ptr-1]
      const left = this.tables.ltable[TABLE_FILTER][pos - 1] || 0;
      const right = this.tables.rtable[TABLE_FILTER][pos - 1] || 0;

      // Modulation (0x01-0x7F)
      if (left >= 0x01 && left <= 0x7F) {
        vs.filterModTicks = left;
        vs.filterModSpeed = (right & 0x80) ? (right - 256) : right;
        vs.ptr[TABLE_FILTER]++;
        break;
      }
      // Set filter (0x80-0xFE)
      else if (left >= 0x80 && left <= 0xFE) {
        const highBits = (left & 0x07) << 8;
        vs.tableFilter = highBits | right;
        vs.ptr[TABLE_FILTER]++;
        break;
      }
      // Jump (0xFF)
      else if (left === 0xFF) {
        if (right === 0x00 || right >= 0xFF) {
          vs.filterActive = false;
          break;
        }
        vs.ptr[TABLE_FILTER] = right;
        jumpCount++;
        continue;
      }
      else {
        vs.ptr[TABLE_FILTER]++;
        break;
      }
    }

    return vs.tableFilter;
  }

  // Execute speedtable step (simple)
  executeSpeedtable(voice) {
    const vs = this.voiceState[voice];
    const TABLE_SPEED = 3;
    if (!vs.speedActive || vs.ptr[TABLE_SPEED] === 0) return vs.tableSpeed;

    let jumpCount = 0;
    const MAX_JUMPS = 10;

    while (jumpCount < MAX_JUMPS) {
      const pos = vs.ptr[TABLE_SPEED];
      // GT2 uses 1-based pointers, reads with [ptr-1]
      const left = this.tables.ltable[TABLE_SPEED][pos - 1] || 0;
      const right = this.tables.rtable[TABLE_SPEED][pos - 1] || 0;

      if (left === 0xFF) {
        if (right === 0x00 || right >= 0xFF) {
          vs.speedActive = false;
          break;
        }
        vs.ptr[TABLE_SPEED] = right;
        jumpCount++;
        continue;
      }

      vs.tableSpeed = left || 1;
      vs.ptr[TABLE_SPEED]++;
      break;
    }
    return vs.tableSpeed;
  }

  // Execute realtime commands (1-4) on each tick for smooth modulation
  // AND execute GT2 tables (Wavetable, Pulsetable, Filtertable)
  // Logic updated to match gplay.c (GT2 source) exactly
  executeRealtimeCommands() {
    for (let voice = 0; voice < 3; voice++) {
      const vs = this.voiceState[voice];
      // Skip inactive or muted voices
      if (!vs.active || vs.muted) continue;

      let skipEffects = false;

      // GT2 Hard Restart: Process HR timer before wavetable
      // During HR, wavetable still executes but gate is masked to OFF
      if (vs.hrTimer > 0) {
        vs.hrTimer--;
        if (vs.hrTimer === 0) {
          // HR complete - enable gate
          vs.gate = 0xFF;
          // IMPORTANT: If no wavetable, we must write gate ON now!
          // Otherwise the gate stays OFF from the initial HR write
          if (!vs.waveActive) {
            const regVal = vs.wave & vs.gate;
            this.setVoiceReg(voice, 0x04, regVal);
            console.log(`🔓 V${voice} HR complete, NO wavetable - writing gate ON: 0x${regVal.toString(16)}`);
          } else {
            console.log(`🔓 V${voice} HR complete, wavetable will handle gate`);
          }
        }
      }

      // 1. Wavetable Execution (updates vs.wave directly)
      let waveResult = this.executeWavetable(voice);
      if (waveResult) {
        // Write updated waveform to SID using gate mask
        // During hard restart: vs.gate = 0xFE clears gate bit
        // After hard restart: vs.gate = 0xFF passes gate bit
        const regVal = vs.wave & vs.gate;
        const hasGate = (regVal & 0x01) !== 0;

        // Track gate state changes
        if (!this.lastGateState) this.lastGateState = [null, null, null];
        if (this.lastGateState[voice] !== hasGate) {
          console.log(`🚦 V${voice} GATE ${hasGate ? 'ON' : 'OFF'}: wave=0x${vs.wave.toString(16)}, reg=0x${regVal.toString(16)}, ptr=${vs.ptr[0]}`);
          this.lastGateState[voice] = hasGate;
        }

        this.setVoiceReg(voice, 0x04, regVal);
      } else if (!vs.waveActive && vs.active) {
        // No wavetable - voice might not have one assigned
        if (!this.noWtblCount) this.noWtblCount = [0, 0, 0];
        if (this.noWtblCount[voice] < 3) {
          console.log(`⚪ V${voice} NO WAVETABLE: waveActive=${vs.waveActive}, ptr=${vs.ptr[0]}, inst=${vs.instrumentIndex}`);
          this.noWtblCount[voice]++;
        }
      }

      if (waveResult) {

        // GT2: if (note != 0x80) update frequency
        if (waveResult.noteChanged) {
          if (waveResult.absolute) {
            // Absolute note (0x81-0xDF masked to 0x01-0x5F)
            const ratio = Math.pow(2, vs.tableNote / 12.0);
            const newFreq = Math.round(vs.baseSidFreq * ratio);
            vs.currentFrequency = Math.max(0, Math.min(65535, newFreq));
          } else {
            // Relative note (0x00-0x7F from wavetable right column)
            // GT2 format: 0x00-0x5F = up 0-95 semitones, 0x60-0x7F = down 0-31 semitones
            let semitoneOffset;
            if (vs.tableNote < 0x60) {
              semitoneOffset = vs.tableNote;  // Positive offset (0 to +95)
            } else {
              semitoneOffset = -(vs.tableNote - 0x60);  // Negative offset (0 to -31)
            }
            const ratio = Math.pow(2, semitoneOffset / 12.0);
            const newFreq = Math.round(vs.baseSidFreq * ratio);
            vs.currentFrequency = Math.max(0, Math.min(65535, newFreq));
          }

          // Reset Vibrato Phase (GT2 behavior)
          vs.vibratoPhase = 0;
          skipEffects = true;
        }
      }

      // 3. Tick N Effects (Portamento / Vibrato)
      // Only if Wavetable didn't force a note set (SkipEffects)
      if (!skipEffects) {
        const cmd = vs.activeCommand;
        const index = vs.commandData;
        let updateFreq = false;

        // Command 1: Portamento Up
        if (cmd === 0x1) {
          const speed = this.readSpeedtable16bit(index);
          if (speed > 0) {
            vs.currentFrequency += speed;
            updateFreq = true;
          }
        }
        // Command 2: Portamento Down
        else if (cmd === 0x2) {
          const speed = this.readSpeedtable16bit(index);
          if (speed > 0) {
            vs.currentFrequency -= speed;
            updateFreq = true;
          }
        }
        // Command 3: Toneportamento
        else if (cmd === 0x3) {
          const speed = this.readSpeedtable16bit(index);
          if (speed > 0) {
            if (vs.currentFrequency < vs.targetFrequency) {
              vs.currentFrequency += speed;
              if (vs.currentFrequency > vs.targetFrequency) vs.currentFrequency = vs.targetFrequency;
            } else if (vs.currentFrequency > vs.targetFrequency) {
              vs.currentFrequency -= speed;
              if (vs.currentFrequency < vs.targetFrequency) vs.currentFrequency = vs.targetFrequency;
            }
            updateFreq = true;
          }
        }
        // Command 4: Vibrato
        else if (cmd === 0x4) {
          const entry = this.readSpeedtableDual(index);
          let speed = entry.left;
          let depth = entry.right;

          // Check for note-independent mode (bit 7 of speed is set)
          const noteIndependent = (speed & 0x80) !== 0;
          if (noteIndependent) {
            speed = speed & 0x7F; // Clear bit 7 to get actual speed
            // GT2 note-independent: scale depth by frequency
            // This makes vibrato sound consistent across different notes
            // Formula: actualDepth = depth / (freq >> depth)
            if (vs.currentFrequency > 0 && depth > 0) {
              const divisor = vs.currentFrequency >> depth;
              if (divisor > 0) {
                depth = Math.max(1, Math.floor(256 / divisor));
              }
            }
          }

          if (speed > 0 && depth > 0) {
            // GT2 Vibrato Logic:
            // Modify temporary frequency for this tick
            vs.vibratoPhase++;
            if (vs.vibratoPhase >= speed) {
              vs.vibratoPhase = 0;
              vs.vibratoDirection = -vs.vibratoDirection;
            }
            const mod = depth * vs.vibratoDirection;

            let finalFreq = vs.currentFrequency + mod;
            // Clip
            finalFreq = Math.max(0, Math.min(65535, finalFreq));

            this.setVoiceReg(voice, 0x00, finalFreq & 0xFF);
            this.setVoiceReg(voice, 0x01, (finalFreq >> 8) & 0xFF);
            updateFreq = false; // Already poked
          }
        }

        if (updateFreq) {
          vs.currentFrequency = Math.max(0, Math.min(65535, vs.currentFrequency));
          this.setVoiceReg(voice, 0x00, vs.currentFrequency & 0xFF);
          this.setVoiceReg(voice, 0x01, (vs.currentFrequency >> 8) & 0xFF);
        }
      } else {
        // Absolute Note Active - Just write the reset frequency
        this.setVoiceReg(voice, 0x00, vs.currentFrequency & 0xFF);
        this.setVoiceReg(voice, 0x01, (vs.currentFrequency >> 8) & 0xFF);
      }

      // 4. Pulsetable Execution
      let pulseVal = this.executePulsetable(voice);
      this.setVoiceReg(voice, 0x02, pulseVal & 0xFF);
      this.setVoiceReg(voice, 0x03, (pulseVal >> 8) & 0x0F);

      // 5. Filtertable Execution
      let filterVal = this.executeFiltertable(voice);
      if (vs.filterActive) {
        this.poke(0x15, filterVal & 0x07);
        this.poke(0x16, (filterVal >> 3) & 0xFF);
      }
    }
  }



  getMidiNote(noteStr) {
    if (!noteStr || noteStr.length < 3) return 0;
    const notes = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
    const key = noteStr.substring(0, 2).toUpperCase();
    const oct = parseInt(noteStr.substring(2)) || 0;
    const idx = notes.indexOf(key);
    if (idx === -1) return 0;
    return (oct * 12) + idx;
  }
}

registerProcessor('sid-processor', SidProcessor);
