// Auto-generated bundle. Do not edit.
// Contains JXG stub + Stream + jsSID core + reSID + worklet processor.
// Minimal JXG stub providing decompress function for jsSID.ReSID
// This replaces the full JSXGraph library dependency

var JXG = JXG || {};

// Base64 decoding
JXG._base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

JXG._base64Decode = function(data) {
    var result = [];
    var i = 0;
    var len = data.length;

    while (i < len) {
        var c1 = JXG._base64Chars.indexOf(data.charAt(i++));
        var c2 = JXG._base64Chars.indexOf(data.charAt(i++));
        var c3 = JXG._base64Chars.indexOf(data.charAt(i++));
        var c4 = JXG._base64Chars.indexOf(data.charAt(i++));

        var b1 = (c1 << 2) | (c2 >> 4);
        var b2 = ((c2 & 15) << 4) | (c3 >> 2);
        var b3 = ((c3 & 3) << 6) | c4;

        result.push(b1);
        if (c3 !== 64) result.push(b2);
        if (c4 !== 64) result.push(b3);
    }

    return result;
};

// LZW decompression
JXG._lzwDecode = function(data) {
    var dict = {};
    var currChar = data[0];
    var oldPhrase = String.fromCharCode(currChar);
    var result = [oldPhrase];
    var code = 256;
    var phrase;

    for (var i = 1; i < data.length; i++) {
        var currCode = data[i];
        if (currCode < 256) {
            phrase = String.fromCharCode(currCode);
        } else {
            phrase = dict[currCode] ? dict[currCode] : (oldPhrase + oldPhrase.charAt(0));
        }
        result.push(phrase);
        dict[code] = oldPhrase + phrase.charAt(0);
        code++;
        oldPhrase = phrase;
    }

    return result.join('');
};

// Main decompress function: base64 decode then LZW decompress
JXG.decompress = function(str) {
    // Remove whitespace
    str = str.replace(/\s+/g, '');
    // Base64 decode
    var bytes = JXG._base64Decode(str);
    // Convert to 16-bit values for LZW
    var data = [];
    for (var i = 0; i < bytes.length; i += 2) {
        data.push((bytes[i] << 8) | (bytes[i + 1] || 0));
    }
    // LZW decompress
    return JXG._lzwDecode(data);
};

/* Wrapper for accessing strings through sequential reads */
function Stream(str) {
	var position = 0;
	
	function seek(newpos) {
		position = newpos;
	}

	function read(length) {
		var result = str.substr(position, length);
		position += length;
		return result;
	}
	
	/* read a big-endian 32-bit integer */
	function readInt32() {
		var result = ( (str.charCodeAt(position) << 24) +
			(str.charCodeAt(position + 1) << 16) +
			(str.charCodeAt(position + 2) << 8) +
			str.charCodeAt(position + 3));
		position += 4;
		return result;
	}

	/* read a big-endian 16-bit integer */
	function readInt16() {
		var result = ( (str.charCodeAt(position) << 8) + str.charCodeAt(position + 1));
		position += 2;
		return result;
	}
	
	/* read an 8-bit integer */
	function readInt8(signed) {
		var result = str.charCodeAt(position);
		if (signed && result > 127) result -= 256;
		position += 1;
		return result;
	}
	
	function eof() {
		return position >= str.length;
	}
	
	/* read a MIDI-style variable-length integer
		(big-endian value in groups of 7 bits,
		with top bit set to signify that another byte follows)
	*/
	function readVarInt() {
		var result = 0;
		while (true) {
			var b = readInt8();
			if (b & 0x80) {
				result += (b & 0x7f);
				result <<= 7;
			} else {
				/* b is the last byte */
				return result + b;
			}
		}
	}
	
	return {
		'eof': eof,
		'seek': seek,
		'read': read,
		'readInt32': readInt32,
		'readInt16': readInt16,
		'readInt8': readInt8,
		'readVarInt': readVarInt
	};
}

Stream.loadRemoteFile = function (path, callback) {
	var fetch = new XMLHttpRequest();
	fetch.open('GET', path);
	if(fetch.overrideMimeType) fetch.overrideMimeType("text/plain; charset=x-user-defined");
	if(fetch.responseType) fetch.responseType = "arraybuffer";
	fetch.onreadystatechange = function() {
		if(this.readyState == 4 && this.status == 200) {
			/* munge response into a binary string */
			var t = this.responseText || "" ;
			var ff = [];
			var mx = t.length;
			var scc= String.fromCharCode;
			for (var z = 0; z < mx; z++) {
				ff[z] = scc(t.charCodeAt(z) & 255);
			}
			callback(ff.join(""));
		}
	};
	fetch.send();
};


Stream.Base64DecodeEnumerator = function(input)
{
    this._input = input;
    this._index = -1;
    this._buffer = [];
};

Stream.Base64DecodeEnumerator.prototype =
{
    current: 64,

    codex : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",

    moveNext: function()
    {
        if (this._buffer.length > 0)
        {
            this.current = this._buffer.shift();
            return true;
        }
        else if (this._index >= (this._input.length - 1))
        {
            this.current = 64;
            return false;
        }
        else
        {
            var enc1 = this.codex.indexOf(this._input.charAt(++this._index));
            var enc2 = this.codex.indexOf(this._input.charAt(++this._index));
            var enc3 = this.codex.indexOf(this._input.charAt(++this._index));
            var enc4 = this.codex.indexOf(this._input.charAt(++this._index));

            var chr1 = (enc1 << 2) | (enc2 >> 4);
            var chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
            var chr3 = ((enc3 & 3) << 6) | enc4;

            this.current = chr1;

            if (enc3 != 64)
                this._buffer.push(chr2);

            if (enc4 != 64)
                this._buffer.push(chr3);

            return true;
        }
    }
};

Stream.Base64Decode = function(input) {

        var output = []; 

        var enumerator = new Stream.Base64DecodeEnumerator(input);
        while (enumerator.moveNext())
        {
            var charCode = enumerator.current;
            output.push(String.fromCharCode(charCode));
        }

        return output.join("");
};




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



// Main Object
jsSID.ReSID = function(opts) {
        opts = opts || {};
        this.sid_model = opts.model || jsSID.chip.model.MOS6581;
        var clkRate = opts.clock || jsSID.chip.clock.PAL;
	var sampleRate = opts.sampleRate || 44100;
	var method = opts.method || jsSID.ReSID.sampling_method.SAMPLE_FAST;

	this.bus_value = 0;
	this.bus_value_ttl = 0;
	this.ext_in = 0;

	// these are arrays/tables built at runtime
	this.sample = null;
	this.fir = null;

	this.voice = new Array(3);
	for(var i = 0; i < 3; i++) {
		this.voice[i] = new jsSID.ReSID.Voice();
	}
	this.filter = new jsSID.ReSID.Filter();
	this.extfilt = new jsSID.ReSID.ExternalFilter();
	this.voice[0].set_sync_source(this.voice[2]);
	this.voice[1].set_sync_source(this.voice[0]);
	this.voice[2].set_sync_source(this.voice[1]);

	this.set_sampling_parameters(clkRate, method, sampleRate);
        this.set_chip_model(this.sid_model);
}
//FIXME: original had destructor calling "delete[] sample; delete fir[]". Shouldn't matter we don't.

jsSID.ReSID.const = Object.freeze({
	FIR_N: 125,
	FIR_RES_INTERPOLATE: 285,
	FIR_RES_FAST: 51473,
	FIR_SHIFT: 15,
	RINGSIZE: 16384,
	FIXP_SHIFT: 16,
	FIXP_MASK: 0xffff
});

// EnvelopeGenerator
jsSID.ReSID.EnvelopeGenerator = function() {
	this.reset();
};

jsSID.ReSID.EnvelopeGenerator.State = Object.freeze({
	ATTACK: {}, DECAY_SUSTAIN: {}, RELEASE: {}
});

jsSID.ReSID.EnvelopeGenerator.rate_counter_period = Array(
	9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251
);

// this one seems like overkill... idx +  (idx<<4) should do it...
jsSID.ReSID.EnvelopeGenerator.sustain_level = Array(
	0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff
);

jsSID.ReSID.EnvelopeGenerator.prototype.reset = function() {
	this.envelope_counter = 0;
	this.attack = 0;
	this.decay = 0;
	this.sustain = 0;
	this.release = 0;
	this.gate = 0;
	this.rate_counter = 0;
	this.exponential_counter = 0;
	this.exponential_counter_period = 1;
	this.state = jsSID.ReSID.EnvelopeGenerator.State.RELEASE;
	this.rate_period = jsSID.ReSID.EnvelopeGenerator.rate_counter_period[this.release];
	this.hold_zero = true;
};

jsSID.ReSID.EnvelopeGenerator.prototype.writeCONTROL_REG = function(control) {
	var gate_next = control & 0x01;
	if (!this.gate && gate_next) {
		this.state = jsSID.ReSID.EnvelopeGenerator.State.ATTACK;
		this.rate_period = jsSID.ReSID.EnvelopeGenerator.rate_counter_period[this.attack];
		this.hold_zero = false;
	} else if (this.gate && !gate_next) {
		this.state = jsSID.ReSID.EnvelopeGenerator.State.RELEASE;
		this.rate_period = jsSID.ReSID.EnvelopeGenerator.rate_counter_period[this.release];
	}
	this.gate = gate_next;
};

jsSID.ReSID.EnvelopeGenerator.prototype.writeATTACK_DECAY = function(attack_decay) {
	this.attack = (attack_decay >> 4) & 0x0f;
	this.decay = attack_decay & 0x0f;
	if (this.state == jsSID.ReSID.EnvelopeGenerator.State.ATTACK) {
		this.rate_period = jsSID.ReSID.EnvelopeGenerator.rate_counter_period[this.attack];
	} else if (this.state == jsSID.ReSID.EnvelopeGenerator.State.DECAY_SUSTAIN) {
		this.rate_period = jsSID.ReSID.EnvelopeGenerator.rate_counter_period[this.decay];
	}
};

jsSID.ReSID.EnvelopeGenerator.prototype.writeSUSTAIN_RELEASE = function(sustain_release) {
	this.sustain = (sustain_release >> 4) & 0x0f;
	this.release = sustain_release & 0x0f;
	if (this.state == jsSID.ReSID.EnvelopeGenerator.State.RELEASE) {
		this.rate_period = jsSID.ReSID.EnvelopeGenerator.rate_counter_period[this.release];
	}
};

jsSID.ReSID.EnvelopeGenerator.prototype.readENV = function() {
	return this.output();
};

jsSID.ReSID.EnvelopeGenerator.prototype.output = function() {
	return this.envelope_counter;
};

// definitions of EnvelopeGenerator methods below here are called for every sample
jsSID.ReSID.EnvelopeGenerator.prototype.clock_one = function() {
	if (++this.rate_counter & 0x8000) {
		++this.rate_counter;
		this.rate_counter &= 0x7fff;
	}
	if (this.rate_counter != this.rate_period) {
		return;
	}
	this.clock_common();
};

jsSID.ReSID.EnvelopeGenerator.prototype.clock_delta = function(delta_t) {
	var rate_step = this.rate_period - this.rate_counter;
	if (rate_step <= 0) {
		rate_step += 0x7fff;
	}
	while (delta_t) {
		if (delta_t < rate_step) {
			this.rate_counter += delta_t;
			if (this.rate_counter & 0x8000) {
				++this.rate_counter;
				this.rate_counter &= 0x7fff;
			}
			return;
		}

		delta_t -= rate_step;

		this.clock_common();

		rate_step = this.rate_period;
	}

};

// FIXME: this is part of the fast path, maybe factoring it out was not the best?
jsSID.ReSID.EnvelopeGenerator.prototype.clock_common = function() {
	this.rate_counter = 0;
	if (this.state == jsSID.ReSID.EnvelopeGenerator.State.ATTACK || ++this.exponential_counter == this.exponential_counter_period) {
		this.exponential_counter = 0;
		if (this.hold_zero) {
			return;
		}
		switch (this.state) {
			case jsSID.ReSID.EnvelopeGenerator.State.ATTACK:
				++this.envelope_counter;
				this.envelope_counter &= 0xff;
				if (this.envelope_counter == 0xff) {
					this.state = jsSID.ReSID.EnvelopeGenerator.State.DECAY_SUSTAIN;
					this.rate_period = jsSID.ReSID.EnvelopeGenerator.rate_counter_period[this.decay];
				}
				break;
			case jsSID.ReSID.EnvelopeGenerator.State.DECAY_SUSTAIN:
				if (this.envelope_counter != jsSID.ReSID.EnvelopeGenerator.sustain_level[this.sustain]) {
					--this.envelope_counter;
					this.envelope_counter &= 0xff;
				}
				break;
			case jsSID.ReSID.EnvelopeGenerator.State.RELEASE:
				--this.envelope_counter;
				this.envelope_counter &= 0xff;
				break;
		}
		this.set_exponential_counter();
	}
};

jsSID.ReSID.EnvelopeGenerator.prototype.set_exponential_counter = function() {
	switch (this.envelope_counter) {
		case 0xff:
			this.exponential_counter_period = 1;
			break;
		case 0x5d:
			this.exponential_counter_period = 2;
			break;
		case 0x36:
			this.exponential_counter_period = 4;
			break;
		case 0x1a:
			this.exponential_counter_period = 8;
			break;
		case 0x0e:
			this.exponential_counter_period = 16;
			break;
		case 0x06:
			this.exponential_counter_period = 30;
			break;
		case 0x00:
			this.exponential_counter_period = 1;
			this.hold_zero = true;
			break;
	}
};

// Waveform object
jsSID.ReSID.WaveformGenerator = function() {
	this.sync_source = this;
	this.set_chip_model(jsSID.chip.model.MOS6581);
	this.reset();
}

jsSID.ReSID.WaveformGenerator.prototype.set_chip_model = function(model) {
	if (model == jsSID.chip.model.MOS6581) {
		this.wave__ST = jsSID.ReSID.WaveformGenerator.comboTable.wave6581__ST;
		this.wave_P_T = jsSID.ReSID.WaveformGenerator.comboTable.wave6581_P_T;
		this.wave_PS_ = jsSID.ReSID.WaveformGenerator.comboTable.wave6581_PS_;
		this.wave_PST = jsSID.ReSID.WaveformGenerator.comboTable.wave6581_PST;
	} else {
		this.wave__ST = jsSID.ReSID.WaveformGenerator.comboTable.wave8580__ST;
		this.wave_P_T = jsSID.ReSID.WaveformGenerator.comboTable.wave8580_P_T;
		this.wave_PS_ = jsSID.ReSID.WaveformGenerator.comboTable.wave8580_PS_;
		this.wave_PST = jsSID.ReSID.WaveformGenerator.comboTable.wave8580_PST;
	}
};

jsSID.ReSID.WaveformGenerator.prototype.reset = function() {
	this.accumulator = 0;
	this.shift_register = 0x7ffff8;
	this.freq = 0;
	this.waveform = 0;
	this.pw = 0;
	this.test = 0;
	this.ring_mod = 0;
	this.sync = 0;
	this.msb_rising = false;
};

jsSID.ReSID.WaveformGenerator.prototype.set_sync_source = function(source) {
	this.sync_source = source;
	source.sync_dest = this;
};

jsSID.ReSID.WaveformGenerator.prototype.writeFREQ_LO = function(freq_lo) {
	this.freq = (this.freq & 0xff00) | (freq_lo & 0x00ff);
};

jsSID.ReSID.WaveformGenerator.prototype.writeFREQ_HI = function(freq_hi) {
	this.freq = ((freq_hi << 8) & 0xff00) | (this.freq & 0x00ff);
};

jsSID.ReSID.WaveformGenerator.prototype.writePW_LO = function(pw_lo) {
	this.pw = (this.pw & 0xf00) | (pw_lo & 0x0ff);
};

jsSID.ReSID.WaveformGenerator.prototype.writePW_HI = function(pw_hi) {
	this.pw = ((pw_hi << 8) & 0xf00) | (this.pw & 0x0ff);
};

jsSID.ReSID.WaveformGenerator.prototype.writeCONTROL_REG = function(control) {
	this.waveform = (control >> 4) & 0x0f;
	this.ring_mod = control & 0x04;
	this.sync = control & 0x02;
	var test_next = control & 0x08;
	if (test_next) {
		this.accumulator = 0;
		this.shift_register = 0;
	} else if (this.test) {
		this.shift_register = 0x7ffff8;
	}
	this.test = test_next;
};

jsSID.ReSID.WaveformGenerator.prototype.readOSC = function() {
	return this.output() >> 4;
};

// definitions of EnvelopeGenerator methods below here are called for every sample
jsSID.ReSID.WaveformGenerator.prototype.clock_one = function() {
	if (this.test) {
		return;
	}
	var accumulator_prev = this.accumulator;
	this.accumulator += this.freq;
	this.accumulator &= 0xffffff;
	this.msb_rising = !(accumulator_prev & 0x800000) && (this.accumulator & 0x800000);
	if (!(accumulator_prev & 0x080000) && (this.accumulator & 0x080000)) {
		var bit0 = ((this.shift_register >> 22) ^ (this.shift_register >> 17)) & 0x1;
		this.shift_register <<= 1;
		this.shift_register &= 0x7fffff;
		this.shift_register |= bit0;
	}
};

jsSID.ReSID.WaveformGenerator.prototype.clock_delta = function(delta_t) {
	if (this.test) {
		return;
	}
	var accumulator_prev = this.accumulator;
	var delta_accumulator = delta_t * this.freq;
	this.accumulator += delta_accumulator;
	this.accumulator &= 0xffffff;
	this.msb_rising = !(accumulator_prev & 0x800000) && (this.accumulator & 0x800000);
	var shift_period = 0x100000;
	while (delta_accumulator) {
		if (delta_accumulator < shift_period) {
			shift_period = delta_accumulator;
			if (shift_period <= 0x080000) {
				if (((this.accumulator - shift_period) & 0x080000) || !(this.accumulator & 0x080000)) {
					break;
				}
			} else {
				if (((this.accumulator - shift_period) & 0x080000) && !(this.accumulator & 0x080000)) {
					break;
				}
			}
		}

		var bit0 = ((this.shift_register >> 22) ^ (this.shift_register >> 17)) & 0x1;
		this.shift_register <<= 1;
		this.shift_register &= 0x7fffff;
		this.shift_register |= bit0;

		delta_accumulator -= shift_period;
	}
};

jsSID.ReSID.WaveformGenerator.prototype.synchronize = function() {
	if (this.msb_rising && this.sync_dest.sync && !(this.sync && this.sync_source.msb_rising)) {
		this.sync_dest.accumulator = 0;
	}
};

jsSID.ReSID.WaveformGenerator.prototype.output____ = function() {
	return 0x000;
};

jsSID.ReSID.WaveformGenerator.prototype.output___T = function() {
	var msb = (this.ring_mod ? this.accumulator ^ this.sync_source.accumulator : this.accumulator) & 0x800000;
	// FIXME: may need to mask inversion here
	return ((msb ? ~this.accumulator : this.accumulator) >> 11) & 0xfff;
};

jsSID.ReSID.WaveformGenerator.prototype.output__S_ = function() {
	return this.accumulator >> 12;
};

jsSID.ReSID.WaveformGenerator.prototype.output_P__ = function() {
	return (this.test || (this.accumulator >> 12) >= this.pw) ? 0xfff : 0x000;
};

jsSID.ReSID.WaveformGenerator.prototype.outputN___ = function() {
	return  ((this.shift_register & 0x400000) >> 11) |
		((this.shift_register & 0x100000) >> 10) |
		((this.shift_register & 0x010000) >> 7) |
		((this.shift_register & 0x002000) >> 5) |
		((this.shift_register & 0x000800) >> 4) |
		((this.shift_register & 0x000080) >> 1) |
		((this.shift_register & 0x000010) << 1) |
		((this.shift_register & 0x000004) << 2);
};


jsSID.ReSID.WaveformGenerator.prototype.output__ST = function() {
	return this.wave__ST[this.output__S_()] << 4;
};

jsSID.ReSID.WaveformGenerator.prototype.output_P_T = function() {
	return (this.wave_P_T[this.output___T() >> 1] << 4) & this.output_P__();
};

jsSID.ReSID.WaveformGenerator.prototype.output_PS_ = function() {
	return (this.wave_PS_[this.output__S_()] << 4) & this.output_P__();
};

jsSID.ReSID.WaveformGenerator.prototype.output_PST = function() {
	return (this.wave_PST[this.output__S_()] << 4) & this.output_P__();
};

jsSID.ReSID.WaveformGenerator.prototype.outputN__T = function() {
	return 0;
};

jsSID.ReSID.WaveformGenerator.prototype.outputN_S_ = function() {
	return 0;
};

jsSID.ReSID.WaveformGenerator.prototype.outputN_ST = function() {
	return 0;
};

jsSID.ReSID.WaveformGenerator.prototype.outputNP__ = function() {
	return 0;
};

jsSID.ReSID.WaveformGenerator.prototype.outputNP_T = function() {
	return 0;
};

jsSID.ReSID.WaveformGenerator.prototype.outputNPS_ = function() {
	return 0;
};

jsSID.ReSID.WaveformGenerator.prototype.outputNPST = function() {
	return 0;
};

jsSID.ReSID.WaveformGenerator.prototype.output = function() {
	switch(this.waveform) {
		default:
		case 0x0:
			return this.output____();
		case 0x1:
			return this.output___T();
		case 0x2:
			return this.output__S_();
		case 0x3:
			return this.output__ST();
		case 0x4:
			return this.output_P__();
		case 0x5:
			return this.output_P_T();
		case 0x6:
			return this.output_PS_();
		case 0x7:
			return this.output_PST();
		case 0x8:
			return this.outputN___();
		case 0x9:
			return this.outputN__T();
		case 0xa:
			return this.outputN_S_();
		case 0xb:
			return this.outputN_ST();
		case 0xc:
			return this.outputNP__();
		case 0xd:
			return this.outputNP_T();
		case 0xe:
			return this.outputNPS_();
		case 0xf:
			return this.outputNPST();
	}
};

jsSID.ReSID.WaveformGenerator.comboTableCompressed = 
	"H4sIAMRzKlICA+1cT2/bNhRXl0OGrViPuxRNvsF6W4F1sYAddhmw4wZsSzRsww7DGgHDZne2ExYd" +
	"kB22Zp9gFrAPEO0UD3EdFT30GN3qommsIocYqGtrqBu7+be9R1K2JNuSU7VWE/EHU0/UE0lRpMin" +
	"n/UoSXFiYiJiBmeiJJ4ExFl+nPV/C3AOIIn2T1T7n+e4AJiaSqVE+yf6+Z8S7X+62/+SD5c5ZmZS" +
	"qUWAaH8x/4v2F/O/aH8x/4v2F/O/QIIwfSmV4NrLkizPjb3MnlQkRZkf8XwHiktCejUdoFdlVc3y" +
	"bFSoq6qombwkKxklk1lQc7nFhfiff/KS05MhcZQEUIitfCxd01aOlR6S8LQaBqLpq+760ONuva6v" +
	"8XrqNOjFmyCLWrFY1oql9fL6+nrE+hvBV08MT11YnEkIgI2g9nGlJ970hkFTG+Zdb3saNF/UUb1p" +
	"3udxE4NhVh7gUaNS2TIqm9XNarUa2D8Mw3JfO41zicGwrB13fdx6KMcCPGLVpOciHlNZqzWsWr1Z" +
	"bzabvH0Mfp5NhWXZGCzbfsLLceJPIbUN2LXtVrvVbrd5OTaEjt3pPAMtyj0I+539/X0WPziA3+HB" +
	"4eFh5+CI4T8P+MGDDpwCJ+LpB5DQtiALyKhj70HA+DMqWYFYSbgEuBB6QTYeewpbkAYG0JMnrjg2" +
	"i80EVph2ZrgFcCNqVqNWozk+pgKrzM57xMvBvCAqORIDpt/h5fj1hLckxomvYd2ALgAdoWJsVSpG" +
	"Bcp5UIFuAmlMns990zR4d2LlGsST312qRj27Hue6HL0/7i9/g1Wze54jJVf6wAcw4ggKQ0B5vVTS" +
	"yiUYFjRCbhZ1Pliweq7pOgwkRNL4dWm++qzqmkdPiH/ICi5/RdNoSc55JOIAe1wU/iCB/YPEPIG9" +
	"bIAJsLCYy6kLOTALFEXKZzKKKstgPDB9NgNmhOw1LNxIqyo3Rgbr5ZDy56FMxWcYjRNzn8q0TFlK" +
	"JlKXL4r3IIGkYjLm8ifiTf/a1Amvf0T+TXon5vq/GzH9eyH6933xGSYupqSLl1Izqbj5/8jtHxUf" +
	"x1z+JxHTfxai/8IXn+VW1hxyX5/Pzc3FXP9vI9Jp3wWr5e9dZiXyfVeoRN4NgjI/f1z+Tfbmp/wQ" +
	"qFeUH718nfITl2lJVdNqOp0O5veUq564qv6MvB7ILHJ7mWyW83twjB3Pcd4vL6uZfCafz0OdKd+H" +
	"Ibew0OX9MAj+X8z/Yv4X87+Y/8X8fyrnf0nM/4Pm/5yY/wUEBCQpJW6BgEBiMM0l/ukDFoGY/wUE" +
	"xPwvICAg5v9xYyJW/u8F+H+c2PqfEv+/pLd/BP+/KQrR/ol+/kX7n/Lnf4j/38ziK8H/i/YX879o" +
	"//jm/xPv/y/aP9LzH6/9R6Tr10mMWFpaWqaOZtzHjHnqWdxhzxW3uE8a33lx2N62o+HfTggOfDjy" +
	"uf8lnA+ZTHDdz0uXU8nmf8/OxvX9k4xBPrb/v8zSQUpMrDj+/zIHHJG5AoOqZrJ0X6XIAHI05HL4" +
	"LdCr8P0PiZa6z7uU9CQb4yVnZyBuFI5xfYSV583BOf6cWIkwfWmAVf+xnkrTNV1f09gu7hf1YrEE" +
	"AbalMvyo/3+0GZR6Qw9UcH92g3B//CHYcPIJOikAdwO1pnnP2YN906xUNnFT2dzcgl91q1qtBqSm" +
	"0313f/DcvxMywdd80Tr1/q/VG/V6vdFoNpseNXWhD5zvW13Zau3uttttm/n7D8LeHjrvuyf/w8PD" +
	"o4Hu/70FAND/3wVcQmBvb3D+9ELgEnZ3Wy3XhQWBV9EFuAUNuBm1Rr1GVwCo1wJv4IgN0LPfXJbd" +
	"QEAXgI5AOwR0DNPcxI1J1wCguGeaETrgUBCDPzobQeeQ3lM09EEb+giOBur/X6YDAo4MOmxhoECw" +
	"kWMNhw626x5guljVHc3YB0Cpf3Bn6w14Bu2QGabw568BJfD8pYD1AXzrNYx3AowOagQsgDmQy3Hj" +
	"AIDGgqpSIyKLEW5QKF0Tg4IaJ2muoEeZKRJkwPRh/muFpYup/nOzHyXaBE6lZuBFQLwACsRDgMXF" +
	"f3GcO+HdbyLS/ZmcPOn+f9HqL505F3P/ezti+uf0/5NS0tnzqQsn3/8v7uf/TMzP/5sh+jd88VnH" +
	"7MFwNrr/X9T6fxgx/Qch+m988SuO2QmG6rwc7v8Xhq9C6Lsv3XwfrsHJyToVDOm00u//x81gWUF2" +
	"UEb/P87scV4vQ7cgFTTRr2azLMr4PjiW41xfTmU8X56yfj3OD8x8xvxx/7//Ev78L8dc/lLE9NdD" +
	"3i5/d71mIk95g7/SLuPap6RQKIy5/sR3PUsjnj8wPeD6QD1bUBBxzfdG/4vz1x8NyysrIfkTh0se" +
	"wvGG/X95bTA/S6VG/lpdDUn/ty+udyXyu8V/1jz5aVqRUb9akfK9pdJNDakcxvuWiqVymXK/Zcb9" +
	"rrP1X4kndMmVkXAt4l+wdyLyz7f7eeeuRJLtljvuwh0aNjY2wgoYHO/S1bd95flp7FuBLOCtO8el" +
	"D02XxPVs7/v0FZesmBW+3q1pbiL3jbw35b63GPddDea/R8H2UO6c8ecP3XG+sGsPD7d3fOdbrrVy" +
	"R8GjQO69VnvM9+uUWq7XG0i+I/OOa+82/fx7P2yXtDl57Sa0n1jBhP1TL3vf2mXc/W6bsfeUv7cp" +
	"h0+3lFR38/nP/Jw+l/uM3d/fx7/4+/7kx7V+KduPZP6RB37eX1AQAgKJxZS4BQICScG0qkw73wIx" +
	"IkDcEwGBhOL1C8L/P5ngtMVvhajZjKYn0rDPMLufakpkDOj//tAYLyzD8HxJuP18fgOjuAYEuAK4" +
	"iID/ATiBVooAgAAA";

// expand/split tables
jsSID.ReSID.WaveformGenerator.comboTable = function() {
	var data = JXG.decompress(jsSID.ReSID.WaveformGenerator.comboTableCompressed);
	var stream = Stream(data);
	var names = [
		"wave6581__ST", "wave6581_P_T", "wave6581_PS_", "wave6581_PST",
		"wave8580__ST", "wave8580_P_T", "wave8580_PS_", "wave8580_PST"
	];
	var ret = {};
	// 8 tables
	for(var i = 0; i < 8; i++) {
		var table = new Array(4096);
		for(var j = 0; j < 4096; j++) {
			table[j] = stream.readInt8();
		}
		ret[names[i]] = table;
	}
	return ret;
}();


// Voice class
jsSID.ReSID.Voice = function() {
	this.muted = false;
	this.wave_zero = 0;
	this.voice_DC = 0;

	this.envelope = new jsSID.ReSID.EnvelopeGenerator();
	this.wave = new jsSID.ReSID.WaveformGenerator();
	this.set_chip_model(jsSID.chip.model.MOS6581);
};


jsSID.ReSID.Voice.prototype.set_chip_model = function(model) {
	this.wave.set_chip_model(model);
	if (model == jsSID.chip.model.MOS6581) {
		this.wave_zero = 0x380;
		this.voice_DC = 0x800*0xff;
	} else {
		this.wave_zero = 0x800;
		this.voice_DC = 0;
	}
};

jsSID.ReSID.Voice.prototype.set_sync_source = function(source) {
	this.wave.set_sync_source(source.wave);
};

jsSID.ReSID.Voice.prototype.writeCONTROL_REG = function(control) {
	this.wave.writeCONTROL_REG(control);
	this.envelope.writeCONTROL_REG(control);
};

jsSID.ReSID.Voice.prototype.reset = function() {
	this.wave.reset();
	this.envelope.reset();
};

jsSID.ReSID.Voice.prototype.mute = function(enable) {
	this.muted = enable;
};


// definitions of Voice methods below here are called for every sample
jsSID.ReSID.Voice.prototype.output = function() {
	if (!this.muted) {
		return (this.wave.output() - this.wave_zero) * this.envelope.output() + this.voice_DC;
	} else {
		return 0;
	}
};


// ExternalFilter class
jsSID.ReSID.ExternalFilter = function() {
	this.reset();
	this.enabled = true;
	this.set_sampling_parameter(15915.6);
	this.set_chip_model(jsSID.chip.model.MOS6581);
};

jsSID.ReSID.ExternalFilter.prototype.enable_filter = function(enable) {
	this.enabled = enable;
};


jsSID.ReSID.ExternalFilter.prototype.set_sampling_parameter = function(pass_freq) {
	this.w0hp = 105;
	this.w0lp = pass_freq * (2.0 * Math.PI * 1.048576);
	if (this.w0lp > 104858) {
		this.w0lp = 104858;
	}

};

jsSID.ReSID.ExternalFilter.prototype.set_chip_model = function(model) {
	if (model == jsSID.chip.model.MOS6581) {
		this.mixer_DC = ((((0x800 - 0x380) + 0x800)*0xff*3 - 0xfff*0xff/18) >> 7)*0x0f;
	} else {
		this.mixer_DC = 0;
	}
};


jsSID.ReSID.ExternalFilter.prototype.reset = function() {
	this.Vlp = 0;
	this.Vhp = 0;
	this.Vo = 0;
};


// definitions of ExternalFilter methods below here are called for every sample


jsSID.ReSID.ExternalFilter.prototype.clock_one = function(Vi) {
	if (!this.enabled) {
		this.Vlp = 0;
		this.Vhp = 0;
		this.Vo = Vi - this.mixer_DC;
		return;
	}

	var dVlp = (this.w0lp >> 8) * (Vi - this.Vlp) >> 12;
	var dVhp = this.w0hp * (this.Vlp - this.Vhp) >> 20;
	this.Vo = this.Vlp - this.Vhp;
	this.Vlp += dVlp;
	this.Vhp += dVhp;

};


jsSID.ReSID.ExternalFilter.prototype.clock_delta = function(Vi, delta_t) {
	if (!this.enabled) {
		this.Vlp = 0;
		this.Vhp = 0;
		this.Vo = Vi - this.mixer_DC;
		return;
	}
	var delta_t_flt = 8;
	while (delta_t) {
		if (delta_t < delta_t_flt) {
			delta_t_flt = delta_t;
		}
		var dVlp = (this.w0lp * delta_t_flt >> 8) * (Vi - this.Vlp) >> 12;
		var dVhp = this.w0hp * delta_t_flt * (this.Vlp - this.Vhp) >> 20;
		this.Vo = this.Vlp - this.Vhp;
		this.Vlp += dVlp;
		this.Vhp += dVhp;
		delta_t -= delta_t_flt;
	}
};


jsSID.ReSID.ExternalFilter.prototype.output = function() {
	return this.Vo;
};


// constructor, no.. just a collection of functions for now
jsSID.ReSID.PointPlotter = {};

jsSID.ReSID.PointPlotter.interpolate = function(inP, plot, res) {
	var k1, k2;
	var p0 = 0;
	var p1 = 1;
	var p2 = 2;
	var p3 = 3;
	var pn = inP.length - 1;

	for (; p2 != pn; ++p0, ++p1, ++p2, ++p3) {
		if (inP[p1][0] == inP[p2][0]) {
			continue;
		}
		if (inP[p0][0] == inP[p1][0] && inP[p2][0] == inP[p3][0]) {
			k1 = (inP[p2][1] - inP[p1][1]) / (inP[p2][0] - inP[p1][0]);
			k2 = k1;
		} else if (inP[p0][0] == inP[p1][0]) {
			k2 = (inP[p3][1] - inP[p1][1]) / (inP[p3][0] - inP[p1][0]);
			k1 = (3 * (inP[p2][1] - inP[p1][1]) / (inP[p2][0] - inP[p1][0]) - k2) / 2;
		} else if (inP[p2][0] == inP[p3][0]) {
			k1 = (inP[p2][1] - inP[p0][1]) / (inP[p2][0] - inP[p0][0]);
			k2 = (3 * (inP[p2][1] - inP[p1][1]) / (inP[p2][0] - inP[p1][0]) - k1) / 2;
		} else {
			k1 = (inP[p2][1] - inP[p0][1]) / (inP[p2][0] - inP[p0][0]);
			k2 = (inP[p3][1] - inP[p1][1]) / (inP[p3][0] - inP[p1][0]);
		}
		jsSID.ReSID.PointPlotter.interpolate_segment(inP[p1][0], inP[p1][1], inP[p2][0], inP[p2][1], k1, k2, plot, res);
	}


};

jsSID.ReSID.PointPlotter.cubic_coefficients = function(x1, y1, x2, y2, k1, k2) {
	var dx = x2 - x1;
	var dy = y2 - y1;
	var a = ((k1 + k2) - 2 * dy / dx) / (dx * dx);
	var b = ((k2 - k1) / dx - 3 * (x1 + x2) * a) / 2;
	var c = k1 - (3 * x1 * a + 2 * b) * x1;
	var d = y1 - ((x1 * a + b) * x1 + c) * x1;
	return new Object({ a: a, b: b, c: c, d: d });
};

jsSID.ReSID.PointPlotter.interpolate_brute_force = function(x1, y1, x2, y2, k1, k2, plot, res) {
	var cc = jsSID.ReSID.PointPlotter.cubic_coefficients(x1, y1, x2, y2, k1, k2);
	for (var x = x1; x <= x2; x += res) {
		var y = ((cc.a * x + cc.b) * x + cc.c) * x + cc.d;
		//plot[x] = (y < 0) ? 0 : y;
		plot[Math.floor(x)] = ((y < 0) ? 0 : y) + 0.5;
	}
};


jsSID.ReSID.PointPlotter.interpolate_forward_difference = function(x1, y1, x2, y2, k1, k2, plot, res) {
	var cc = jsSID.ReSID.PointPlotter.cubic_coefficients(x1, y1, x2, y2, k1, k2);
	var y = ((cc.a * x1 + cc.b) * x1 + cc.c) * x1 + cc.d;
	var dy = (3 * cc.a * (x1 + res) + 2 * cc.b) * x1 * res + ((cc.a * res + cc.b) * res + cc.c) * res;
	var d2y = (6 * cc.a * (x1 + res) + 2 * cc.b) * res * res;
	var d3y = 6 * cc.a * res * res * res;
	for (var x = x1; x <= x2; x += res) {
		//plot[x] = (y < 0) ? 0 : y;
		plot[Math.floor(x)] = ((y < 0) ? 0 : y) + 0.5;
		y += dy;
		dy += d2y;
		d2y += d3y;
	}
};

jsSID.ReSID.PointPlotter.spline_brute_force = false;

jsSID.ReSID.PointPlotter.interpolate_segment = 
	jsSID.ReSID.PointPlotter.spline_brute_force ?
	jsSID.ReSID.PointPlotter.interpolate_brute_force :
	jsSID.ReSID.PointPlotter.interpolate_forward_difference;


// Filter class
jsSID.ReSID.Filter = function() {
	this.fc = 0;
	this.res = 0;
	this.filt = 0;
	this.voice3off = 0;
	this.hp_bp_lp = 0;
	this.vol = 0;
	this.Vhp = 0;
	this.Vbp = 0;
	this.Vlp = 0;
	this.Vnf = 0;
	this.enabled = true;
	this.w0 = 0;
	this.w0_ceil_1 = 0;
	this.w0_ceil_dt = 0;
	this.mixerDC = 0;

	this.f0_6581 = new Array(2048);
	this.f0_8580 = new Array(2048);
	// Create mappings from FC to cutoff frequency.
	jsSID.ReSID.PointPlotter.interpolate(jsSID.ReSID.Filter.f0_points_6581, this.f0_6581, 1.0);
	jsSID.ReSID.PointPlotter.interpolate(jsSID.ReSID.Filter.f0_points_8580, this.f0_8580, 1.0);

	this.set_chip_model(jsSID.chip.model.MOS6581);
};

jsSID.ReSID.Filter.f0_points_6581 = new Array(
	[    0,   220 ], [    0,   220 ], [  128,   230 ], [  256,   250 ],
	[  384,   300 ], [  512,   420 ], [  640,   780 ], [  768,  1600 ],
	[  832,  2300 ], [  896,  3200 ], [  960,  4300 ], [  992,  5000 ],
	[ 1008,  5400 ], [ 1016,  5700 ], [ 1023,  6000 ], [ 1023,  6000 ],
	[ 1024,  4600 ], [ 1024,  4600 ], [ 1032,  4800 ], [ 1056,  5300 ],
	[ 1088,  6000 ], [ 1120,  6600 ], [ 1152,  7200 ], [ 1280,  9500 ],
	[ 1408, 12000 ], [ 1536, 14500 ], [ 1664, 16000 ], [ 1792, 17100 ],
	[ 1920, 17700 ], [ 2047, 18000 ], [ 2047, 18000 ]
);

jsSID.ReSID.Filter.f0_points_8580 = new Array(
	[    0,     0 ], [    0,     0 ], [  128,   800 ], [  256,  1600 ],
	[  384,  2500 ], [  512,  3300 ], [  640,  4100 ], [  768,  4800 ],
	[  896,  5600 ], [ 1024,  6500 ], [ 1152,  7500 ], [ 1280,  8400 ],
	[ 1408,  9200 ], [ 1536,  9800 ], [ 1664, 10500 ], [ 1792, 11000 ],
	[ 1920, 11700 ], [ 2047, 12500 ], [ 2047, 12500 ]
);

jsSID.ReSID.Filter.prototype.enable_filter = function(enable) {
	this.enabled = enable;
};

jsSID.ReSID.Filter.prototype.set_chip_model = function(model) {
	if (model == jsSID.chip.model.MOS6581) {
		this.mixer_DC = -0xfff*0xff/18 >> 7;
		this.f0 = this.f0_6581;
		this.f0_points = jsSID.ReSID.Filter.f0_points_6581;
	} else {
		this.mixer_DC = 0;
		this.f0 = this.f0_8580;
		this.f0_points = jsSID.ReSID.Filter.f0_points_8580;
	}
	this.f0_count = this.f0_points.length;
	this.set_w0();
	this.set_Q();
};

jsSID.ReSID.Filter.prototype.reset = function() {
	this.fc = 0;
	this.res = 0;
	this.filt = 0;
	this.voice3off = 0;
	this.hp_bp_lp = 0;
	this.vol = 0;
	this.Vhp = 0;
	this.Vbp = 0;
	this.Vlp = 0;
	this.Vnf = 0;


	this.set_w0();
	this.set_Q();
};

jsSID.ReSID.Filter.prototype.writeFC_LO = function(fc_lo) {
	this.fc = (this.fc & 0x7f8) | (fc_lo & 0x007);
	this.set_w0();
};

jsSID.ReSID.Filter.prototype.writeFC_HI = function(fc_hi) {
	this.fc = ((fc_hi << 3) & 0x7f8) | (this.fc & 0x007);
	this.set_w0();
};

jsSID.ReSID.Filter.prototype.writeRES_FILT = function(res_filt) {
	this.res = (res_filt >> 4) & 0x0f;
	this.set_Q();
	this.filt = res_filt & 0x0f;
};

jsSID.ReSID.Filter.prototype.writeMODE_VOL = function(mode_vol) {
	this.voice3off = mode_vol & 0x80;
	this.hp_bp_lp = (mode_vol >> 4) & 0x07;
	this.vol = mode_vol & 0x0f;
};

jsSID.ReSID.Filter.prototype.set_w0 = function() {
	this.w0 = 2 * Math.PI * this.f0[this.fc] * 1.048576;

	// FIXME: move these to be const
	var w0_max_1 = 2 * Math.PI * 16000 * 1.048576;
	var w0_max_dt = 2 * Math.PI * 4000 * 1.048576;

	this.w0_ceil_1 = this.w0 <= w0_max_1 ? this.w0 : w0_max_1;
	this.w0_ceil_dt = this.w0 <= w0_max_dt ? this.w0 : w0_max_dt;
};

jsSID.ReSID.Filter.prototype.set_Q = function() {
	this._1024_div_Q = 1024.0 / (0.707 + 1.0 * this.res / 0x0f);
};


// definitions of Filter methods below here are called for every sample


jsSID.ReSID.Filter.prototype.clock_one = function(voice1, voice2, voice3, ext_in) {
	voice1 >>= 7;
	voice2 >>= 7;
	if (this.voice3off && !(this.filt & 0x04)) {
		voice3 = 0;
	} else {
		voice3 >>= 7;
	}
	ext_in >>= 7;

	if (!this.enabled) {
		this.Vnf = voice1 + voice2 + voice3 + ext_in;
		this.Vhp = 0;
		this.Vbp = 0;
		this.Vlp = 0;
		return;
	}


	var Vi;
	switch (this.filt) {
		default:
		case 0x0:
			Vi = 0;
			this.Vnf = voice1 + voice2 + voice3 + ext_in;
			break;
		case 0x1:
			Vi = voice1;
			this.Vnf = voice2 + voice3 + ext_in;
			break;
		case 0x2:
			Vi = voice2;
			this.Vnf = voice1 + voice3 + ext_in;
			break;
		case 0x3:
			Vi = voice1 + voice2;
			this.Vnf = voice3 + ext_in;
			break;
		case 0x4:
			Vi = voice3;
			this.Vnf = voice1 + voice2 + ext_in;
			break;
		case 0x5:
			Vi = voice1 + voice3;
			this.Vnf = voice2 + ext_in;
			break;
		case 0x6:
			Vi = voice2 + voice3;
			this.Vnf = voice1 + ext_in;
			break;
		case 0x7:
			Vi = voice1 + voice2 + voice3;
			this.Vnf = ext_in;
			break;
		case 0x8:
			Vi = ext_in;
			this.Vnf = voice1 + voice2 + voice3;
			break;
		case 0x9:
			Vi = voice1 + ext_in;
			this.Vnf = voice2 + voice3;
			break;
		case 0xa:
			Vi = voice2 + ext_in;
			this.Vnf = voice1 + voice3;
			break;
		case 0xb:
			Vi = voice1 + voice2 + ext_in;
			this.Vnf = voice3;
			break;
		case 0xc:
			Vi = voice3 + ext_in;
			this.Vnf = voice1 + voice2;
			break;
		case 0xd:
			Vi = voice1 + voice3 + ext_in;
			this.Vnf = voice2;
			break;
		case 0xe:
			Vi = voice2 + voice3 + ext_in;
			this.Vnf = voice1;
			break;
		case 0xf:
			Vi = voice1 + voice2 + voice3 + ext_in;
			this.Vnf = 0;
			break;
	}
	var dVbp = (this.w0_ceil_1 * this.Vhp >> 20);
	var dVlp = (this.w0_ceil_1 * this.Vbp >> 20);
	this.Vbp -= dVbp;
	this.Vlp -= dVlp;
	this.Vhp = (this.Vbp * this._1024_div_Q >> 10) - this.Vlp - Vi;
};

jsSID.ReSID.Filter.prototype.clock_delta = function(voice1, voice2, voice3, ext_in, delta_t) {
	voice1 >>= 7;
	voice2 >>= 7;
	if (this.voice3off && !(this.filt & 0x04)) {
		voice3 = 0;
	} else {
		voice3 >>= 7;
	}
	ext_in >>= 7;

	if (!this.enabled) {
		this.Vnf = voice1 + voice2 + voice3 + ext_in;
		this.Vhp = 0;
		this.Vbp = 0;
		this.Vlp = 0;
		return;
	}


	var Vi;
	switch (this.filt) {
		default:
		case 0x0:
			Vi = 0;
			this.Vnf = voice1 + voice2 + voice3 + ext_in;
			break;
		case 0x1:
			Vi = voice1;
			this.Vnf = voice2 + voice3 + ext_in;
			break;
		case 0x2:
			Vi = voice2;
			this.Vnf = voice1 + voice3 + ext_in;
			break;
		case 0x3:
			Vi = voice1 + voice2;
			this.Vnf = voice3 + ext_in;
			break;
		case 0x4:
			Vi = voice3;
			this.Vnf = voice1 + voice2 + ext_in;
			break;
		case 0x5:
			Vi = voice1 + voice3;
			this.Vnf = voice2 + ext_in;
			break;
		case 0x6:
			Vi = voice2 + voice3;
			this.Vnf = voice1 + ext_in;
			break;
		case 0x7:
			Vi = voice1 + voice2 + voice3;
			this.Vnf = ext_in;
			break;
		case 0x8:
			Vi = ext_in;
			this.Vnf = voice1 + voice2 + voice3;
			break;
		case 0x9:
			Vi = voice1 + ext_in;
			this.Vnf = voice2 + voice3;
			break;
		case 0xa:
			Vi = voice2 + ext_in;
			this.Vnf = voice1 + voice3;
			break;
		case 0xb:
			Vi = voice1 + voice2 + ext_in;
			this.Vnf = voice3;
			break;
		case 0xc:
			Vi = voice3 + ext_in;
			this.Vnf = voice1 + voice2;
			break;
		case 0xd:
			Vi = voice1 + voice3 + ext_in;
			this.Vnf = voice2;
			break;
		case 0xe:
			Vi = voice2 + voice3 + ext_in;
			this.Vnf = voice1;
			break;
		case 0xf:
			Vi = voice1 + voice2 + voice3 + ext_in;
			this.Vnf = 0;
			break;
	}

	var delta_t_flt = 8;
	while (delta_t) {
		if (delta_t < delta_t_flt) {
			delta_t_flt = delta_t;
		}
		var w0_delta_t = this.w0_ceil_dt * delta_t_flt >> 6;
		var dVbp = w0_delta_t * this.Vhp >> 14;
		var dVlp = w0_delta_t * this.Vbp >> 14;
		this.Vbp -= dVbp;
		this.Vlp -= dVlp;
		this.Vhp = (this.Vbp * this._1024_div_Q >> 10) - this.Vlp - Vi;
		delta_t -= delta_t_flt;
	}
};


jsSID.ReSID.Filter.prototype.output = function() {
	if (!this.enabled) {
		return (this.Vnf + this.mixer_DC) * this.vol;
	}
	var Vf;
	switch (this.hp_bp_lp) {
		default:
		case 0x0:
			Vf = 0;
			break;
		case 0x1:
			Vf = this.Vlp;
			break;
		case 0x2:
			Vf = this.Vbp;
			break;
		case 0x3:
			Vf = this.Vlp + this.Vbp;
			break;
		case 0x4:
			Vf = this.Vhp;
			break;
		case 0x5:
			Vf = this.Vlp + this.Vhp;
			break;
		case 0x6:
			Vf = this.Vbp + this.Vhp;
			break;
		case 0x7:
			Vf = this.Vlp + this.Vbp + this.Vhp;
			break;
	}
	return (this.Vnf + Vf + this.mixer_DC) * this.vol;
};


jsSID.ReSID.sampling_method = Object.freeze({
	SAMPLE_FAST: {},
	SAMPLE_INTERPOLATE: {},
	SAMPLE_RESAMPLE_INTERPOLATE: {},
	SAMPLE_RESAMPLE_FAST: {},
	SAMPLE_AVERAGE: {}
});

jsSID.ReSID.prototype.set_chip_model = function(model) {
	for (var i = 0; i < 3; i++) {
		this.voice[i].set_chip_model(model);
	}

	this.filter.set_chip_model(model);
	this.extfilt.set_chip_model(model);
};

jsSID.ReSID.prototype.reset = function() {
	for (var i = 0; i < 3; i++) {
		this.voice[i].reset();
	}
	this.filter.reset();
	this.extfilt.reset();
	this.bus_value = 0;
	this.bus_value_ttl = 0;
};

jsSID.ReSID.prototype.input = function(sample) {
	this.ext_in = (sample << 4) * 3;
};


jsSID.ReSID.prototype.output = function(bits) {
	if(!bits) {
		bits = 16;
	}
	var range = 1 << bits;
	var half = range >> 1;
	var sample = this.extfilt.output()  /((4095 * 255 >> 7) * 3 * 15 * 2 / range);
	if (sample >= half) {
		return half - 1;
	}
	if (sample < -half) {
		return -half;
	}
	return sample;
};


jsSID.ReSID.prototype.read = function(offset) {
	switch (offset) {
			// We don't model the potentiometers
		case 0x19:
		case 0x1a:
			return 0xFF;
		case 0x1b:
			return this.voice[2].wave.readOSC();
		case 0x1c:
			return this.voice[2].envelope.readENV();
		default:
			return this.bus_value;
	}
};

jsSID.ReSID.prototype.poke = function(offset, value) {
	this.write(offset, value);
};

jsSID.ReSID.prototype.pokeDigi = function(offset, value) {
	// not yet implemented
	return;
};

jsSID.ReSID.prototype.write = function(offset, value) {
	this.bus_value = value;
	this.bus_value_ttl = 0x2000;

	switch (offset) {
		case 0x00:
			this.voice[0].wave.writeFREQ_LO(value);
			break;
		case 0x01:
			this.voice[0].wave.writeFREQ_HI(value);
			break;
		case 0x02:
			this.voice[0].wave.writePW_LO(value);
			break;
		case 0x03:
			this.voice[0].wave.writePW_HI(value);
			break;
		case 0x04:
			this.voice[0].writeCONTROL_REG(value);
			break;
		case 0x05:
			this.voice[0].envelope.writeATTACK_DECAY(value);
			break;
		case 0x06:
			this.voice[0].envelope.writeSUSTAIN_RELEASE(value);
			break;
		case 0x07:
			this.voice[1].wave.writeFREQ_LO(value);
			break;
		case 0x08:
			this.voice[1].wave.writeFREQ_HI(value);
			break;
		case 0x09:
			this.voice[1].wave.writePW_LO(value);
			break;
		case 0x0a:
			this.voice[1].wave.writePW_HI(value);
			break;
		case 0x0b:
			this.voice[1].writeCONTROL_REG(value);
			break;
		case 0x0c:
			this.voice[1].envelope.writeATTACK_DECAY(value);
			break;
		case 0x0d:
			this.voice[1].envelope.writeSUSTAIN_RELEASE(value);
			break;
		case 0x0e:
			this.voice[2].wave.writeFREQ_LO(value);
			break;
		case 0x0f:
			this.voice[2].wave.writeFREQ_HI(value);
			break;
		case 0x10:
			this.voice[2].wave.writePW_LO(value);
			break;
		case 0x11:
			this.voice[2].wave.writePW_HI(value);
			break;
		case 0x12:
			this.voice[2].writeCONTROL_REG(value);
			break;
		case 0x13:
			this.voice[2].envelope.writeATTACK_DECAY(value);
			break;
		case 0x14:
			this.voice[2].envelope.writeSUSTAIN_RELEASE(value);
			break;
		case 0x15:
			this.filter.writeFC_LO(value);
			break;
		case 0x16:
			this.filter.writeFC_HI(value);
			break;
		case 0x17:
			this.filter.writeRES_FILT(value);
			break;
		case 0x18:
			this.filter.writeMODE_VOL(value);
			break;
		default:
			break;
	}
};


jsSID.ReSID.prototype.mute= function(channel, enable) {
  if (channel >= 3) return;
  this.voice[channel].mute(enable);
};

jsSID.ReSID.prototype.enable_filter = function(enable) {
	this.filter.enable_filter(enable);
};

jsSID.ReSID.prototype.enable_external_filter = function(enable) {
	this.extfilt.enable_filter(enable);
};

jsSID.ReSID.prototype.I0 = function(x) {
	var I0e = 1e-6;			// FIXME: const, used once
	var sum = 1;
	var u = 1;
	var n = 1;
	var halfx = x / 2.0;
	var temp;
	do {
		temp = halfx / n++;
		u *= temp * temp;
		sum += u;
	} while (u >= I0e * sum);
	return sum;
};


// Use a clock freqency of 985248Hz for PAL C64, 1022730Hz for NTSC C64.
jsSID.ReSID.prototype.set_sampling_parameters = function(clock_freq, method, sample_freq, pass_freq, filter_scale) {
	pass_freq = pass_freq || -1;
	filter_scale = filter_scale || 0.97;

	if (method == jsSID.ReSID.sampling_method.SAMPLE_RESAMPLE_INTERPOLATE || method == jsSID.ReSID.sampling_method.SAMPLE_RESAMPLE_FAST) {
		if (jsSID.ReSID.const.FIR_N * clock_freq / sample_freq >= jsSID.ReSID.const.RINGSIZE) {
			return false;
		}
	}
	if (pass_freq < 0) {
		pass_freq = 20000;
		if (2 * pass_freq / sample_freq >= 0.9) {
			pass_freq = 0.9 * sample_freq / 2;
		}
	} else if (pass_freq > 0.9 * sample_freq / 2) {
		return false;
	}
	if (filter_scale < 0.9 || filter_scale > 1.0) {
		return false;
	}
	this.extfilt.set_sampling_parameter(pass_freq);
	this.clock_frequency = clock_freq;
	this.mix_freq = sample_freq;
	this.sampling = method;
	this.cycles_per_sample = Math.floor(clock_freq / sample_freq * (1 << jsSID.ReSID.const.FIXP_SHIFT) + 0.5);
	this.sample_offset = 0;
	this.sample_prev = 0;

	if (method != jsSID.ReSID.sampling_method.SAMPLE_RESAMPLE_INTERPOLATE && method != jsSID.ReSID.sampling_method.SAMPLE_RESAMPLE_FAST) {
		this.sample = null;
		this.fir = null;
		return true;
	}

	var A = -20 * (Math.log(1.0 / (1 << 16)) / Math.LN10);		// FIXME: constant
	var dw = (1 - 2 * pass_freq / sample_freq) * Math.PI;
	var wc = (2 * pass_freq / sample_freq + 1) * Math.PI / 2;
	var beta = 0.1102 * (A - 8.7);			// FIXME: constant
	var I0beta = this.I0(beta);				// FIXME: constant
	var N = Math.floor((A - 7.95) / (2.285 * dw) + 0.5);
	N += N & 1;

	var f_samples_per_cycle = sample_freq / clock_freq;
	var f_cycles_per_sample = clock_freq / sample_freq;
	// FIXME: cast int became floor
	this.fir_N = Math.floor(N * f_cycles_per_sample) + 1;
	this.fir_N |= 1;

	var res = (method == jsSID.ReSID.sampling_method.SAMPLE_RESAMPLE_INTERPOLATE) ? jsSID.ReSID.const.FIR_RES_INTERPOLATE : jsSID.ReSID.const.FIR_RES_FAST;
	var n = Math.ceil(Math.log(res / f_cycles_per_sample) / Math.log(2));
	this.fir_RES = 1 << n;

	this.fir = new Array(this.fir_N * this.fir_RES);

	for (var i = 0; i < this.fir_RES; i++) {
		var fir_offset = i * this.fir_N + this.fir_N / 2;
		// FIXME: i below was cast to double before. should be ok, clean up when confirmed
		var j_offset = i / this.fir_RES;
		for (var j = -this.fir_N / 2; j <= this.fir_N / 2; j++) {
			var jx = j - j_offset;
			var wt = wc * jx / f_cycles_per_sample;
			var temp = jx / (this.fir_N / 2);
			var Kaiser = Math.abs(temp) <= 1 ? this.I0(beta * Math.sqrt(1 - temp * temp)) / I0beta : 0;
			var sincwt = Math.abs(wt) >= 1e-6 ? Math.sin(wt) / wt : 1;
			var val = (1 << jsSID.ReSID.const.FIR_SHIFT) * filter_scale * f_samples_per_cycle * wc / Math.PI * sincwt * Kaiser;
			// FIXME: was a cast to short, convered to Math.floor. Clean once confirmed
			this.fir[fir_offset + j] = Math.floor(val + 0.5);
		}
	}

	// Allocate sample buffer.
	if (!this.sample) {
		this.sample = new Array(jsSID.ReSID.const.RINGSIZE * 2);
	}
	// Clear sample buffer.
	for (var k = 0; k < jsSID.ReSID.const.RINGSIZE * 2; k++) {
		this.sample[k] = 0;
	}
	this.sample_index = 0;
	return true;
};

jsSID.ReSID.prototype.adjust_sampling_frequency = function(sample_freq) {
	// FIXME: casting warning, using floor
	this.cycles_per_sample = Math.floor(this.clock_frequency/sample_freq*(1 << jsSID.ReSID.const.FIXP_SHIFT) + 0.5);
};

jsSID.ReSID.prototype.clock_one = function() {
	var i;
	if (--this.bus_value_ttl <= 0) {
		this.bus_value = 0;
		this.bus_value_ttl = 0;
	}
	for (i = 0; i < 3; i++) {
		this.voice[i].envelope.clock_one();
	}
	for (i = 0; i < 3; i++) {
		this.voice[i].wave.clock_one();
	}
	for (i = 0; i < 3; i++) {
		this.voice[i].wave.synchronize();
	}
	this.filter.clock_one(this.voice[0].output(), this.voice[1].output(), this.voice[2].output(), this.ext_in);
	this.extfilt.clock_one(this.filter.output());
};

jsSID.ReSID.prototype.clock_delta = function(delta_t) {
	var i;
	if (delta_t <= 0) return;

	this.bus_value_ttl -= delta_t;
	if (this.bus_value_ttl <= 0) {
		this.bus_value = 0;
		this.bus_value_ttl = 0;
	}

	// Clock amplitude modulators.
	for (i = 0; i < 3; i++) {
		this.voice[i].envelope.clock_delta(delta_t);
	}

	// Clock and synchronize oscillators.
	// Loop until we reach the current cycle.
	var delta_t_osc = delta_t;
	while (delta_t_osc) {
		var delta_t_min = delta_t_osc;
		for (i = 0; i < 3; i++) {
			var wave = this.voice[i].wave;

			if (!(wave.sync_dest.sync && wave.freq)) {
				continue;
			}

			var freq = wave.freq;
			var accumulator = wave.accumulator;
			var delta_accumulator = (accumulator & 0x800000 ? 0x1000000 : 0x800000) - accumulator;
			var delta_t_next = delta_accumulator/freq;

			if (delta_accumulator % freq) {
				++delta_t_next;
			}

			if (delta_t_next < delta_t_min) {
				delta_t_min = delta_t_next;
			}
		}

		// Clock oscillators.
		for (i = 0; i < 3; i++) {
			this.voice[i].wave.clock_delta(delta_t_min);
		}

		// Synchronize oscillators.
		for (i = 0; i < 3; i++) {
			this.voice[i].wave.synchronize();
		}

		delta_t_osc -= delta_t_min;
	}

	// Clock filter.
	this.filter.clock_delta(this.voice[0].output(), this.voice[1].output(), this.voice[2].output(), this.ext_in, delta_t);

	// Clock external filter.
	this.extfilt.clock_delta(this.filter.output(), delta_t);

};

// Below here clocking with audio sampling
// Main one here call appropriate type
jsSID.ReSID.prototype.clock = function(delta_t, buf, n, interleave, buf_offset) {
	interleave = interleave || 1;
	buf_offset = buf_offset || 0;
	switch (this.sampling) {
		default:
		case jsSID.ReSID.sampling_method.SAMPLE_FAST:
			return this.clock_fast(delta_t, buf, n, interleave, buf_offset);
		case jsSID.ReSID.sampling_method.SAMPLE_INTERPOLATE:
			return this.clock_interpolate(delta_t, buf, n, interleave, buf_offset);
		case jsSID.ReSID.sampling_method.SAMPLE_RESAMPLE_INTERPOLATE:
			return this.clock_resample_interpolate(delta_t, buf, n, interleave, buf_offset);
		case jsSID.ReSID.sampling_method.SAMPLE_RESAMPLE_FAST:
			return this.clock_resample_fast(delta_t, buf, n, interleave, buf_offset);
		case jsSID.ReSID.sampling_method.SAMPLE_AVERAGE:
			return this.clock_average(delta_t, buf, n, interleave, buf_offset);
	}
};

jsSID.ReSID.prototype.clock_fast = function(delta_t, buf, n, interleave, buf_offset) {
	var s = 0;
	for (;;) {
		var next_sample_offset = this.sample_offset + this.cycles_per_sample + (1 << (jsSID.ReSID.const.FIXP_SHIFT - 1));
		var delta_t_sample = next_sample_offset >> jsSID.ReSID.const.FIXP_SHIFT;
		if (delta_t_sample > delta_t) {
			break;
		}
		if (s >= n) {
			return s;
		}
		this.clock_delta(delta_t_sample);
		delta_t -= delta_t_sample;
		this.sample_offset = (next_sample_offset & jsSID.ReSID.const.FIXP_MASK) - (1 << (jsSID.ReSID.const.FIXP_SHIFT - 1));
		// new sample output w/ offset
		var final_sample = parseFloat(this.output()) / 32768;
		var buf_idx = s++ * interleave + buf_offset;
		buf[buf_idx] = final_sample;
	}
	this.clock_delta(delta_t);
	this.sample_offset -= delta_t << jsSID.ReSID.const.FIXP_SHIFT;
	delta_t = 0;
	return s;
};


jsSID.ReSID.prototype.clock_interpolate = function(delta_t, buf, n, interleave, buf_offset) {
	var s = 0;
	var i;
	for (;;) {
		var next_sample_offset = this.sample_offset + this.cycles_per_sample;
		var delta_t_sample = next_sample_offset >> jsSID.ReSID.const.FIXP_SHIFT;
		if (delta_t_sample > delta_t) {
			break;
		}
		if (s >= n) {
			return s;
		}
		for (i = 0; i < delta_t_sample - 1; i++) {
			this.clock_one();
		}
		if (i < delta_t_sample) {
			this.sample_prev = this.output();
			this.clock_one();
		}

		delta_t -= delta_t_sample;
		this.sample_offset = next_sample_offset & jsSID.ReSID.const.FIXP_MASK;

		var sample_now = this.output();
		// new sample output w/ offset
		var final_sample = parseFloat(this.sample_prev + (this.sample_offset * (sample_now - this.sample_prev) >> jsSID.ReSID.const.FIXP_SHIFT)) / 32768;
		var buf_idx = s++ * interleave + buf_offset;
		buf[buf_idx] = final_sample;
		this.sample_prev = sample_now;
	}

	for (i = 0; i < delta_t - 1; i++) {
		this.clock_one();
	}
	if (i < delta_t) {
		this.sample_prev = this.output();
		this.clock_one();
	}
	this.sample_offset -= delta_t << jsSID.ReSID.const.FIXP_SHIFT;
	delta_t = 0;
	return s;

};


// SAMPLE_AVERAGE — not in reSID. SAMPLE_INTERPOLATE point-samples a signal
// that is clocked at ~1 MHz and full of edges (saw, pulse, sync), so every
// harmonic above 24 kHz folds back into the audio band: a raw saw at C6 was
// only 26 dB above its own inharmonic alias junk, and the real chip has none
// (its output is analog). reSID's own cure, the resampling FIR, is ~1500 taps
// per sample per chip - far beyond a worklet running three chips.
//
// This method still clocks every cycle (so envelopes, sync, filter and the
// 6581 quirks are exactly as before) but, instead of keeping one cycle per
// sample, integrates ALL of them under a triangular kernel two output periods
// wide (a 2nd-order B-spline, i.e. a CIC-2 decimator). Its nulls sit exactly
// on the multiples of the output rate where aliases come from. Costs two
// multiply-adds per cycle; output is delayed by one sample.
jsSID.ReSID.prototype.clock_average = function(delta_t, buf, n, interleave, buf_offset) {
	var FIX = jsSID.ReSID.const.FIXP_SHIFT, MASK = jsSID.ReSID.const.FIXP_MASK;
	// extfilt units -> 16-bit sample, as output() does
	var scale = 1 / ((4095 * 255 >> 7) * 3 * 15 * 2 / 65536);
	if (this.avg_tail === undefined) {
		this.avg_tail = 0; this.avg_tail_w = 0;       // late half of the previous period
		this.avg_pA = 0; this.avg_pB = 0; this.avg_pn = 0; // cycles already clocked into this period
	}
	var s = 0;
	for (;;) {
		var next_sample_offset = this.sample_offset + this.cycles_per_sample;
		var delta_t_sample = next_sample_offset >> FIX;
		if (delta_t_sample > delta_t) {
			break;
		}
		if (s >= n) {
			return s;
		}
		var len = this.avg_pn + delta_t_sample;
		var inv = 1 / len;
		var A = this.avg_pA, B = this.avg_pB;
		for (var i = this.avg_pn; i < len; i++) {
			this.clock_one();
			var x = this.extfilt.Vo, u = (i + 0.5) * inv;
			B += x * u;
			A += x - x * u;
		}
		this.avg_pA = 0; this.avg_pB = 0; this.avg_pn = 0;
		delta_t -= delta_t_sample;
		this.sample_offset = next_sample_offset & MASK;

		var v = (this.avg_tail + A) / ((this.avg_tail_w + len) * 0.5) * scale;
		this.avg_tail = B; this.avg_tail_w = len;
		if (v >= 32767) v = 32767; else if (v < -32768) v = -32768;
		buf[s++ * interleave + buf_offset] = v / 32768;
	}
	// Cycles left over belong to the next period: clock them now, weighted
	// against the nominal period length.
	if (delta_t > 0) {
		var nominal = (this.cycles_per_sample >> FIX) + 1;
		for (var k = 0; k < delta_t; k++) {
			this.clock_one();
			var xx = this.extfilt.Vo, uu = (this.avg_pn + 0.5) / nominal;
			this.avg_pB += xx * uu;
			this.avg_pA += xx - xx * uu;
			this.avg_pn++;
		}
	}
	this.sample_offset -= delta_t << FIX;
	return s;
};

jsSID.ReSID.prototype.clock_resample_interpolate = function(delta_t, buf, n, interleave, buf_offset) {
	var s = 0;
	for (;;) {
		var next_sample_offset = this.sample_offset + this.cycles_per_sample;
		var delta_t_sample = next_sample_offset >> jsSID.ReSID.const.FIXP_SHIFT;
		if (delta_t_sample > delta_t) {
			break;
		}
		if (s >= n) {
			return s;
		}
		for (var i = 0; i < delta_t_sample; i++) {
			this.clock_one();
			this.sample[this.sample_index] = this.output();
			this.sample[this.sample_index + jsSID.ReSID.const.RINGSIZE] = this.sample[this.sample_index];
			++this.sample_index;
			this.sample_index &= 0x3fff;
		}
		delta_t -= delta_t_sample;
		this.sample_offset = next_sample_offset & jsSID.ReSID.const.FIXP_MASK;

		var fir_offset = this.sample_offset * this.fir_RES >> jsSID.ReSID.const.FIXP_SHIFT;
		var fir_offset_rmd = this.sample_offset * this.fir_RES & jsSID.ReSID.const.FIXP_MASK;
		var fir_start = fir_offset * this.fir_N;
		var sample_start = this.sample_index - this.fir_N + jsSID.ReSID.const.RINGSIZE;

		var v1 = 0;
		for (var j = 0; j < this.fir_N; j++) {
			v1 += this.sample[sample_start + j] * this.fir[fir_start + j];
		}

		if (++fir_offset == this.fir_RES) {
			fir_offset = 0;
			--sample_start;
		}
		fir_start = fir_offset * this.fir_N;
	
		var v2 = 0;
		for (var k = 0; k < this.fir_N; k++) {
			v2 += this.sample[sample_start + k] * this.fir[fir_start + k];
		}

		var v = v1 + (fir_offset_rmd * (v2 - v1) >> jsSID.ReSID.const.FIXP_SHIFT);
		v >>= jsSID.ReSID.const.FIR_SHIFT;

		// FIXME constant here
		var half = 1 << 15;
		if (v >= half) {
			v = half - 1;
		} else if (v < -half) {
			v = -half;
		}
		// new sample output w/ offset
		var final_sample = parseFloat(v) / 32768;
		var buf_idx = s++ * interleave + buf_offset;
		buf[buf_idx] = final_sample;
	}

	for (var m = 0; m < delta_t; m++) {
		this.clock_one();
		this.sample[this.sample_index] = this.output();
		this.sample[this.sample_index + jsSID.ReSID.const.RINGSIZE] = this.sample[this.sample_index];
		++this.sample_index;
		this.sample_index &= 0x3fff;
	}
	this.sample_offset -= delta_t << jsSID.ReSID.const.FIXP_SHIFT;
	delta_t = 0;
	return s;
};

jsSID.ReSID.prototype.clock_resample_fast = function(delta_t, buf, n, interleave, buf_offset) {
	var s = 0;
	for (;;) {
		var next_sample_offset = this.sample_offset + this.cycles_per_sample;
		var delta_t_sample = next_sample_offset >> jsSID.ReSID.const.FIXP_SHIFT;
		if (delta_t_sample > delta_t) {
			break;
		}
		if (s >= n) {
			return s;
		}
		for (var i = 0; i < delta_t_sample; i++) {
			this.clock_one();
			this.sample[this.sample_index] = this.output();
			this.sample[this.sample_index + jsSID.ReSID.const.RINGSIZE] = this.sample[this.sample_index];
			++this.sample_index;
			this.sample_index &= 0x3fff;
		}
		delta_t -= delta_t_sample;
		this.sample_offset = next_sample_offset & jsSID.ReSID.const.FIXP_MASK;

		var fir_offset = this.sample_offset * this.fir_RES >> jsSID.ReSID.const.FIXP_SHIFT;
		var fir_start = this.fir_offset * this.fir_N;
		var sample_start = this.sample_index - this.fir_N + jsSID.ReSID.const.RINGSIZE;

		var v = 0;
		for (var j = 0; j < this.fir_N; j++) {
			v += this.sample[sample_start + j] * this.fir[fir_start + j];
		}

		v >>= jsSID.ReSID.const.FIR_SHIFT;

		var half = 1 << 15;			// FIXME: const
		if (v >= half) {
			v = half - 1;
		} else if (v < -half) {
			v = -half;
		}
		// new sample output w/ offset
		var final_sample = parseFloat(v) / 32768;
		var buf_idx = s++ * interleave + buf_offset;
		buf[buf_idx] = final_sample;
	}

	for (var k = 0; k < delta_t; k++) {
		this.clock_one();
		this.sample[this.sample_index] = this.output();
		this.sample[this.sample_index + jsSID.ReSID.const.RINGSIZE] = this.sample[this.sample_index];
		++this.sample_index;
		this.sample_index &= 0x3fff;
	}
	this.sample_offset -= delta_t << jsSID.ReSID.const.FIXP_SHIFT;
	delta_t = 0;
	return s;
};


// generate count samples into buffer at offset
jsSID.ReSID.prototype.generateIntoBuffer = function(count, buffer, offset) {
        //console.log("jsSID.ReSID.generateIntoBuffer (count: " + count + ", offset: " + offset + ")");
        // FIXME: this could be done in one pass. (No?)
        for (var i = offset; i < offset + count; i++) {
                buffer[i] = 0;
        }
	// Carry the fixed-point cycle remainder across calls. Flooring it away
	// each call starved the clock of one sample's worth of cycles every ~33
	// blocks, leaving a single zeroed sample behind — an audible ~10 Hz tick
	// even when nothing was playing.
	if (this.cycle_remainder === undefined) this.cycle_remainder = 0;
	var budget = this.cycles_per_sample * count + this.cycle_remainder;
	var delta = budget >> jsSID.ReSID.const.FIXP_SHIFT;
	this.cycle_remainder = budget & ((1 << jsSID.ReSID.const.FIXP_SHIFT) - 1);
	var s = this.clock(delta, buffer, count, 1, offset);
	// Belt and braces: if the clock still comes up short, repeat the last
	// sample rather than emit the zeroed one (a DC step is a click).
	for (var fill = offset + s; fill < offset + count; fill++) {
		buffer[fill] = fill > offset ? buffer[fill - 1] : 0;
	}
	return s;
};

jsSID.ReSID.prototype.generate = function(samples) {
        var data = new Array(samples);
        this.generateIntoBuffer(samples, data, 0);
        return data;
};

// add driver profile(s) to registry:
jsSID.synth.resid_fast = {
        desc: "ReSID - Fast",
        class: "ReSID",
        opts: { method: jsSID.ReSID.sampling_method.SAMPLE_FAST }
};
jsSID.synth.resid_interpolate = {
        desc: "ReSID - Interpolate",
        class: "ReSID",
        opts: { method: jsSID.ReSID.sampling_method.SAMPLE_INTERPOLATE }
};
jsSID.synth.resid_resample_fast = {
        desc: "ReSID - Resample/Fast (Broken)",
        class: "ReSID",
        opts: { method: jsSID.ReSID.sampling_method.SAMPLE_RESAMPLE_FAST }
};
jsSID.synth.resid_resample_interpolate = {
        desc: "ReSID - Resample/Interpolate",
        class: "ReSID",
        opts: { method: jsSID.ReSID.sampling_method.SAMPLE_RESAMPLE_INTERPOLATE }
};



// AudioWorkletProcessor that expects jsSID and jsSID.ReSID to be present (bundled above)

// GT2 Frequency Tables (from gplay.c) - exact C64 SID frequencies for notes 0-95
const freqtbllo = [
  0x17,0x27,0x39,0x4b,0x5f,0x74,0x8a,0xa1,0xba,0xd4,0xf0,0x0e,
  0x2d,0x4e,0x71,0x96,0xbe,0xe8,0x14,0x43,0x74,0xa9,0xe1,0x1c,
  0x5a,0x9c,0xe2,0x2d,0x7c,0xcf,0x28,0x85,0xe8,0x52,0xc1,0x37,
  0xb4,0x39,0xc5,0x5a,0xf7,0x9e,0x4f,0x0a,0xd1,0xa3,0x82,0x6e,
  0x68,0x71,0x8a,0xb3,0xee,0x3c,0x9e,0x15,0xa2,0x46,0x04,0xdc,
  0xd0,0xe2,0x14,0x67,0xdd,0x79,0x3c,0x29,0x44,0x8d,0x08,0xb8,
  0xa1,0xc5,0x28,0xcd,0xba,0xf1,0x78,0x53,0x87,0x1a,0x10,0x71,
  0x42,0x89,0x4f,0x9b,0x74,0xe2,0xf0,0xa6,0x0e,0x33,0x20,0xff
];
const freqtblhi = [
  0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x02,
  0x02,0x02,0x02,0x02,0x02,0x02,0x03,0x03,0x03,0x03,0x03,0x04,
  0x04,0x04,0x04,0x05,0x05,0x05,0x06,0x06,0x06,0x07,0x07,0x08,
  0x08,0x09,0x09,0x0a,0x0a,0x0b,0x0c,0x0d,0x0d,0x0e,0x0f,0x10,
  0x11,0x12,0x13,0x14,0x15,0x17,0x18,0x1a,0x1b,0x1d,0x1f,0x20,
  0x22,0x24,0x27,0x29,0x2b,0x2e,0x31,0x34,0x37,0x3a,0x3e,0x41,
  0x45,0x49,0x4e,0x52,0x57,0x5c,0x62,0x68,0x6e,0x75,0x7c,0x83,
  0x8b,0x93,0x9c,0xa5,0xaf,0xb9,0xc4,0xd0,0xdd,0xea,0xf8,0xff
];
// SID Synth Processor Body — uses real jsSID.ReSID for authentic SID sound
// Bundled after jsSID/ReSID library code.
// 3 SID chips × 3 voices = 9 voice polyphony (we use 8).
// Each voice maps to a specific chip+channel. GT2 tables write SID registers directly.

const NUM_VOICES = 3; // 1 SID chip per voice, 3 chips = 3-note polyphony
const NUM_CHIPS = 3;
// A released chip keeps running this long after its envelopes reach zero, so
// the filter and output stage settle before it is frozen (see this._idle).
const IDLE_SAMPLES = 4096;
const TWO_PI = 2 * Math.PI;

// GT2 frequency tables (freqtbllo/freqtblhi) are provided by the ReSID library above

// Convert MIDI note to SID frequency register value
function midiToSidFreq(note) {
  // The GT2 table starts at C0: entry 57 is 0x1d46, which at the PAL clock is
  // 440.1 Hz — A4. So table index = MIDI note - 12. The previous offset of 24
  // played EVERYTHING an octave flat (A4 came out at 220 Hz), which also made
  // SID tracks sit an octave under every other instrument in the studio.
  // Interpolate between entries for smooth fractional-semitone sweeps.
  //
  // Clamped to the table (C-0..B-7). Past either end the interpolation used
  // to EXTRAPOLATE, and the result was written to a 16-bit register: a hat
  // table's +72 on a low key wrapped 0x107DE to 0x07DE — a rumble at 1/30th
  // of the intended noise rate.
  const sidNote = Math.max(0, Math.min(95, note - 12));
  const idx = Math.min(94, Math.floor(sidNote));
  const frac = sidNote - idx;
  const freqA = freqtbllo[idx] | (freqtblhi[idx] << 8);
  if (frac < 0.001) return freqA;
  const freqB = freqtbllo[idx + 1] | (freqtblhi[idx + 1] << 8);
  return Math.round(freqA + (freqB - freqA) * frac);
}

// MOS 6581 datasheet envelope times (ms) for register values 0..15. The
// filter envelope below is a software (frame-rate) envelope, as a C64 player
// would run, but its A/D/R nibbles now mean the same times as the chip's own.
const SID_ATTACK_MS = [2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000];
const SID_DECAY_MS = [6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1500, 2400, 3000, 9000, 15000, 24000];

// Everything a preset can set. A preset REPLACES these (performance controls
// excepted) — merging let a drum preset's hidden noise layer (`layerOn`) ride
// along into every preset loaded after it.
const DEFAULT_PARAMS = {
  waveform: 0x41,    // SID control register value (waveform + gate)
  pulseWidth: 0x800, // 12-bit
  ad: 0x0A,          // attack/decay byte
  sr: 0xF8,          // sustain/release byte
  osc2On: false,     // enable oscillator 2
  osc2Waveform: 0x11,
  osc2Detune: 0,     // semitones
  osc2EnvAmt: 0,     // sweep range in semitones (scaled by ×48)
  osc2SweepSpeed: 8, // 0=instant, 15=very slow (decay rate 0-15)
  ringMod: false,
  hardSync: false,
  filterOn: false,
  filterMode: 0x10,  // SID filter type bits (0x10=LP, 0x20=BP, 0x40=HP)
  filterCutoff: 0xFF,// 0-255 (maps to SID regs 0x15/0x16)
  filterReso: 0,     // 0-15
  filterEnvAmt: 0,
  fltAd: 0x08,
  fltSr: 0x00,
  masterVolume: 0x0F,
  layerOn: false,
  // Delayed vibrato, as Martin Galway's players do it: the note starts dead
  // on pitch and the vibrato cuts in after vibDelay seconds at full depth.
  // Wizball's high-score lead measures +-31 cents at ~5.7 Hz after ~240 ms.
  vibDepth: 0,       // cents, 0 = off
  vibRate: 5.5,      // Hz
  vibDelay: 0.24,    // seconds from note-on
  // Velocity -> filter cutoff: each note sets its own cutoff, the way
  // Galway's player writes a new cutoff with every bass note (Wizball's
  // talking bass steps between 40 and 111 of 255). Added to filterCutoff as
  // filterVelAmt * 255 * velocity/127.
  filterVelAmt: 0,
};
const PERFORMANCE_PARAMS = ['pitchBend', 'pitchBendRange', 'portamento', 'portamentoTime'];

// ─── SID Synth Processor ────────────────────────────────────────────────────

class SIDSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Create 3 ReSID instances for 9-voice polyphony (using 8)
    this.sids = [];
    for (let i = 0; i < NUM_CHIPS; i++) {
      const sid = new jsSID.ReSID({
        sampleRate: sampleRate,
        clock: jsSID.chip.clock.PAL,
        model: jsSID.chip.model.MOS6581,
        method: jsSID.ReSID.sampling_method.SAMPLE_AVERAGE
      });
      // Set max volume, no filter type initially
      sid.poke(0x18, 0x0F);
      // Open filter cutoff
      sid.poke(0x15, 0x00);
      sid.poke(0x16, 0xFF);
      this.sids.push(sid);
    }
    // Shadow registers: writes that change nothing are skipped, and a write
    // to the routing/mode/volume registers can be recognised as a DC step.
    this.regs = [];
    for (let i = 0; i < NUM_CHIPS; i++) {
      const r = new Int16Array(32); // reSID powers up with every register at 0
      r[0x18] = 0x0F; r[0x15] = 0x00; r[0x16] = 0xFF;
      this.regs.push(r);
    }
    this._mixBuf = new Float32Array(128);
    this._chipBuf = new Array(128);
    // Idle chips are not clocked. reSID steps every chip cycle by cycle — about
    // 20 % of a core per track for three chips — and the studio runs every
    // track on ONE audio thread, so five SID tracks overran real time and the
    // browser dropped blocks (heard as spikes). A chip whose three envelopes
    // have been at zero for IDLE_SAMPLES outputs its last sample (its DC
    // level, so nothing steps) until any register write wakes it.
    this._idle = new Int32Array(NUM_CHIPS);
    this._hold = new Float32Array(NUM_CHIPS);

    // Voice N = SID chip N. All 3 channels on that chip work together:
    //   Channel 0: main oscillator (osc1)
    //   Channel 2: osc2 (sync/ring source — SID voice 0 syncs to voice 2)
    //   Channel 1: available for sub/extra
    this.voices = [];
    for (let i = 0; i < NUM_VOICES; i++) {
      this.voices.push({
        active: false, played: false, note: 0, velocity: 0,
        chip: i,                      // 1 SID chip per voice
        baseNote: 0,
        sweep: 0,  // current sweep level 0-255 (decays from 255 to 0)
        glide: 0, glideStep: 0,       // portamento offset (semitones) and per-frame step
        tick: 0,                      // samples since this voice's last 50 Hz frame
        age: 0, vib: 0,               // samples since note-on; vibrato offset (semitones)
        layerPending: 0, layerCtrl: 0,
        tbl: {
          wavePtr: 0, wavetime: 0, waveActive: false,
          wave: 0x41, tableNote: 0, absNote: -1,
          pulsePtr: 0, pulseActive: false, pulsetime: 0, tablePulse: 0x800
        }
      });
    }

    this.params = Object.assign({}, DEFAULT_PARAMS, {
      pitchBend: 0, pitchBendRange: 2, portamento: false, portamentoTime: 0.1,
    });
    this._lastNote = null;

    // GT2 table system
    this.tableEnabled = false;
    this.tables = {
      ltable: [new Uint8Array(255), new Uint8Array(255), new Uint8Array(255)],
      rtable: [new Uint8Array(255), new Uint8Array(255), new Uint8Array(255)]
    };
    this.tableStartPtrs = { wave: 0, pulse: 0, filter: 0 };

    // Global filter table state
    this.gflt = { ptr: 0, modTicks: 0, modSpeed: 0, cutoff8: 0xFF };

    // Filter envelope state per voice (simple counter-based)
    this.fltEnvs = [];
    for (let i = 0; i < NUM_VOICES; i++) {
      this.fltEnvs.push({ level: 0, stage: 0, counter: 0 }); // 0=off,1=A,2=D,3=S,4=R
    }

    // 50Hz tick. The filter table (one filter, shared like the real chip's)
    // runs on the global frame clock; each voice runs its own wave/pulse
    // tables, sweep and filter envelope on a frame clock that starts AT its
    // note-on, as a player's frame does. On a free-running global clock the
    // first table row landed 0-20 ms after the key — a kick's noise crack
    // came late by a random amount, after a blip of plain pulse.
    this.tickCounter = 0;
    this.samplesPerTick = sampleRate / 50;
    this._dcX = 0;
    this._dcY = 0;
    this._dcR = Math.exp(-2 * Math.PI * 15 / sampleRate); // ~15 Hz highpass
    this._dcPrimed = false;
    this._droop = [0, 0];
    // Output warm-up: chip initialisation steps the 6581's DC level several
    // times (volume, filter model setup), and each step through the DC
    // blocker becomes an audible pop — a fresh SID track went off like a
    // -16 dB thump before anyone played a note. Mute-then-ramp the first
    // ~150 ms; nothing musical can be playing that early.
    this._rampLen = Math.round(sampleRate * 0.05);
    this._warmup = Math.round(sampleRate * 0.15);

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  // Register write with change detection (a same-value write is a no-op on
  // the chip too). Routing/mode/volume changes move the 6581's DC level.
  _w(chip, addr, value) {
    value &= 0xFF;
    const r = this.regs[chip];
    if (r[addr] === value) return;
    r[addr] = value;
    this._idle[chip] = 0;
    this.sids[chip].poke(addr, value);
    if (addr === 0x17 || addr === 0x18) this._dcStep();
  }

  // Write to SID chip for voice. channel: 0=osc1, 1=layer, 2=osc2(sync/ring source)
  _poke(voiceIdx, channel, reg, value) {
    this._w(this.voices[voiceIdx].chip, channel * 7 + reg, value);
  }

  // The 6581's voices carry a DC offset (reSID's voice_DC), so switching a
  // voice's filter routing, the filter mode or the volume steps the output
  // level — a real 6581 thumps here too, and the coupling cap turns the step
  // into a pop. Routing used to be switched on at the first note after a
  // preset change, so that note opened with a thump 7x louder than itself
  // (Laser Harp: -0.9 FS against a +-0.13 note). Registers are now set when
  // the preset loads; if nothing is sounding, the output is muted while the
  // step settles. A change during a note is left alone — that click is the
  // chip's own.
  _dcStep() {
    for (let c = 0; c < NUM_CHIPS; c++) {
      if (this.voices[c].active) return;
      const vs = this.sids[c].voice;
      for (let k = 0; k < 3; k++) if (vs[k].envelope.envelope_counter !== 0) return;
    }
    this._warmup = Math.max(this._warmup, Math.round(sampleRate * 0.12));
  }

  // Frequencies of all three channels, from the voice's note state.
  _refreshFreqs(vi) {
    const v = this.voices[vi];
    if (!v.played) return;
    const p = this.params, t = v.tbl;
    const off = (p.pitchBend || 0) * (p.pitchBendRange || 0) + v.glide + v.vib;
    const note0 = (t.absNote >= 0 ? t.absNote : v.baseNote + t.tableNote) + off;
    const sweepSt = (p.osc2EnvAmt || 0) * (v.sweep / 255) * 48;
    const det = p.osc2Detune || 0;
    let f0, f2;
    if (p.hardSync || p.ringMod) {
      // voice[0] = synced slave (what we hear, sweeps change its harmonics),
      // voice[2] = sync source at the played note (sets the pitch)
      f0 = midiToSidFreq(note0 + det + sweepSt);
      f2 = midiToSidFreq(v.baseNote + off);
    } else {
      // Plain second oscillator: detune and sweep move osc2 itself.
      // (They used to act only in sync/ring mode, so with OSC2 on alone the
      // detune and env-amount knobs did nothing.)
      f0 = midiToSidFreq(note0);
      f2 = midiToSidFreq(v.baseNote + off + det + sweepSt);
    }
    this._poke(vi, 0, 0x00, f0 & 0xFF); this._poke(vi, 0, 0x01, (f0 >> 8) & 0xFF);
    this._poke(vi, 2, 0x00, f2 & 0xFF); this._poke(vi, 2, 0x01, (f2 >> 8) & 0xFF);
    if (p.layerOn) {
      const f1 = Math.max(0, Math.min(0xFFFF, midiToSidFreq(v.baseNote + (p.layerDetune | 0) + off) + (p.layerFine | 0)));
      this._poke(vi, 1, 0x00, f1 & 0xFF); this._poke(vi, 1, 0x01, (f1 >> 8) & 0xFF);
    }
  }

  // Set pulse width on a channel
  _setPulse(voiceIdx, channel, pw12) {
    this._poke(voiceIdx, channel, 0x02, pw12 & 0xFF);
    this._poke(voiceIdx, channel, 0x03, (pw12 >> 8) & 0x0F);
  }

  // Gate a channel on. The envelope's rate counter is cleared first: that is
  // what a player's hard restart achieves (ADSR $0000 two frames ahead of
  // the note). Without it the counter, still running at the RELEASE rate,
  // is almost always past the new attack period and has to wrap through
  // 0x7FFF — the SID "ADSR bug" — so EVERY note started 32-35 ms late.
  // A keyboard can't look two frames ahead, so the result is applied directly.
  _gateOn(chip, channel, ctrl) {
    const env = this.sids[chip].voice[channel].envelope;
    const reg = channel * 7 + 0x04;
    if (this.regs[chip][reg] & 0x01) this._w(chip, reg, this.regs[chip][reg] & 0xFE);
    env.rate_counter = 0;
    this._w(chip, reg, ctrl | 0x01);
  }

  _gateOff(chip, channel) {
    const reg = channel * 7 + 0x04;
    const cur = this.regs[chip][reg];
    if (cur > 0) this._w(chip, reg, cur & 0xFE);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'noteOn': {
        const vi = msg.voice;
        const v = this.voices[vi];
        if (!v || vi >= NUM_CHIPS) break;
        const p = this.params;

        // Portamento: frame-stepped slide from the last note played, like a
        // tracker's tone-portamento.
        const from = this._lastNote;
        v.glide = (p.portamento && from !== null && from !== msg.note) ? from - msg.note : 0;
        v.glideStep = v.glide ? Math.abs(v.glide) / Math.max(1, (p.portamentoTime || 0) * 50) : 0;
        this._lastNote = msg.note;

        v.active = true;
        v.played = true;
        v.note = msg.note;
        v.velocity = msg.velocity;
        v.baseNote = msg.note;
        v.tick = 0;
        v.age = 0;
        v.vib = 0;
        // A note should never wait out more than the fade-in of a settle mute.
        this._warmup = Math.min(this._warmup, this._rampLen);

        // === SID SYNC ARCHITECTURE ===
        // voice[0] has sync bit → gets RESET by voice[2]'s MSB transitions
        // voice[2] = sync source = determines perceived PITCH (stays at played note)
        // voice[0] = slave = determines HARMONICS (frequency sweeps change timbre)
        //
        // For sync: we HEAR voice[0]. Its pitch appears locked to voice[2]'s rate.
        // Sweeping voice[0]'s frequency changes the harmonic content (laser harp).

        // Init osc2 sweep (starts at max, decays to 0) and table note state
        v.sweep = (p.osc2EnvAmt !== 0) ? 255 : 0;
        const t = v.tbl;
        t.wavePtr = 0; t.wavetime = 0; t.waveActive = false;
        t.pulsePtr = 0; t.pulseActive = false; t.pulsetime = 0;
        t.tableNote = 0; t.absNote = -1; t.tablePulse = p.pulseWidth;

        // === Channel 0: Slave oscillator (what we hear) ===
        this._poke(vi, 0, 0x05, p.ad);
        this._poke(vi, 0, 0x06, p.sr);
        this._setPulse(vi, 0, p.pulseWidth);

        // === Channel 2: Sync source (determines pitch, runs silently or audibly) ===
        if (p.osc2On || p.hardSync || p.ringMod) {
          this._setPulse(vi, 2, p.pulseWidth);
          if (p.osc2On) {
            this._poke(vi, 2, 0x05, p.ad);
            this._poke(vi, 2, 0x06, p.sr);
          } else {
            // Silent: no waveform bits, oscillator still ticks for sync
            this._w(vi, 0x12, 0x00);
          }
        } else {
          this._gateOff(vi, 2);
        }

        // === Channel 1: the LAYER oscillator ===
        // The chip has three oscillators; ch0 carries the note (and its
        // wavetable), ch2 is the sync/ring helper — ch1 was sitting idle.
        // Presets can light it as a second audible voice: detuned unison and
        // octave doubling (the fat Galway/Hubbard leads), or a noise layer
        // fired WITH a tone drum instead of after it. `layerDelay` (frames)
        // gates it late for flam/echo blips.
        v.layerPending = 0;
        if (p.layerOn) {
          const lpw = p.layerPW !== undefined ? p.layerPW : p.pulseWidth;
          this._setPulse(vi, 1, lpw);
          this._poke(vi, 1, 0x05, p.layerAd !== undefined ? p.layerAd : p.ad);
          this._poke(vi, 1, 0x06, p.layerSr !== undefined ? p.layerSr : p.sr);
        } else {
          this._gateOff(vi, 1);
        }

        this._refreshFreqs(vi);

        // Gates on. No gate-off-then-clock is needed first: reSID's envelope
        // reacts to the 0→1 write itself. (The old code clocked the chip 8
        // samples in between and threw them away, which skipped that chip's
        // timeline ahead of the other two.)
        let ctrl = (p.waveform & 0xF0);
        if (p.hardSync) ctrl |= 0x02;
        if (p.ringMod) ctrl |= 0x04;
        this._gateOn(vi, 0, ctrl);
        if (p.osc2On) this._gateOn(vi, 2, p.osc2Waveform & 0xF0);
        if (p.layerOn) {
          const lctrl = (p.layerWave !== undefined ? p.layerWave : p.waveform) & 0xF0;
          if ((p.layerDelay | 0) > 0) {
            v.layerPending = p.layerDelay | 0;
            v.layerCtrl = lctrl;
            this._gateOff(vi, 1);
          } else {
            this._gateOn(vi, 1, lctrl);
          }
        }

        // Filter envelope restarts; tables run their first frame NOW (the
        // note-on frame, as in GT2).
        this.fltEnvs[vi] = { level: 0, stage: 1, counter: 0 }; // start attack
        if (this.tableEnabled) {
          if (this.tableStartPtrs.wave > 0) { t.wavePtr = this.tableStartPtrs.wave; t.waveActive = true; t.wavetime = 0; }
          if (this.tableStartPtrs.pulse > 0) { t.pulsePtr = this.tableStartPtrs.pulse; t.pulseActive = true; }
          if (this.tableStartPtrs.filter > 0) {
            this.gflt.ptr = this.tableStartPtrs.filter; this.gflt.modTicks = 0;
            this._executeFilterTable();
            for (let c = 0; c < NUM_CHIPS; c++) if (c !== vi) this._updateFilter(c);
          }
          this._executeWavetable(vi);
          this._executePulsetable(vi);
          this._refreshFreqs(vi);
        }
        this._updateFilter(vi);
        break;
      }
      case 'noteOff': {
        const vi = msg.voice;
        const v = this.voices[vi];
        if (!v || vi >= NUM_CHIPS) break;
        v.active = false;
        v.layerPending = 0;
        // Gate off, keeping everything else the control registers hold. The
        // old code rewrote them from the patch, which dropped the SYNC and
        // RING bits for the release (Laser Harp / Ring Bell tails jumped to a
        // different pitch and timbre on key-up) and brought back a waveform
        // the wavetable had already silenced (hat: $E0 → noise again).
        this._gateOff(vi, 0);
        this._gateOff(vi, 1);
        this._gateOff(vi, 2);
        this.fltEnvs[vi].stage = 4;
        break;
      }
      case 'param': {
        const { param, value } = msg;
        this.params[param] = value;
        this._paramsChanged();
        break;
      }
      case 'preset': {
        if (msg.params) {
          const keep = {};
          for (const k of PERFORMANCE_PARAMS) keep[k] = this.params[k];
          this.params = Object.assign({}, DEFAULT_PARAMS, msg.params, keep);
          this._resetFilterTable();
          this._paramsChanged();
        }
        break;
      }
      case 'tableData': {
        const t = msg.tableType;
        if (t >= 0 && t < 3) {
          this.tables.ltable[t] = new Uint8Array(msg.ltable);
          this.tables.rtable[t] = new Uint8Array(msg.rtable);
        }
        break;
      }
      case 'tableEnabled': { this.tableEnabled = msg.value; this._paramsChanged(); break; }
      case 'tableStartPtrs': {
        Object.assign(this.tableStartPtrs, msg.ptrs);
        this._resetFilterTable();
        this._paramsChanged();
        break;
      }
      case 'chipModel': {
        const model = msg.value === 8580 ? jsSID.chip.model.MOS8580 : jsSID.chip.model.MOS6581;
        for (let i = 0; i < NUM_CHIPS; i++) this.sids[i].set_chip_model(model);
        break;
      }
    }
  }

  // A new filter table starts from the patch's cutoff, not from wherever the
  // previous preset's table left it (0xFF on a fresh page), which gave the
  // first frame of Filter Acid a wide-open blip.
  _resetFilterTable() {
    const g = this.gflt;
    g.ptr = 0; g.modTicks = 0; g.modSpeed = 0;
    g.cutoff8 = this.params.filterCutoff & 0xFF;
  }

  // Filter/volume registers follow the patch immediately (not at the next
  // note), and sounding voices follow pitch-bend and detune.
  _paramsChanged() {
    for (let c = 0; c < NUM_CHIPS; c++) {
      this._updateFilter(c);
      this._refreshFreqs(c);
    }
  }

  _updateFilter(vi) {
    const p = this.params;
    if (p.filterOn) {
      // A preset with a filter table hands it the cutoff, and the cutoff
      // stays where the table leaves it (GT2 semantics).
      let c8 = this.tableEnabled && this.tableStartPtrs.filter > 0 ? this.gflt.cutoff8 : p.filterCutoff;
      if (p.filterVelAmt) c8 += p.filterVelAmt * 255 * (this.voices[vi].velocity || 0) / 127;
      const fe = this.fltEnvs[vi];
      if (p.filterEnvAmt) c8 += p.filterEnvAmt * fe.level;
      // 8-bit cutoff → 11-bit register. The filter envelope used to write its
      // 8-bit value straight into the 11-bit register — 1/8 of the intended
      // cutoff — so every preset with filter-env amount sat nearly closed
      // (Sync Lead at C6 was all but silent).
      const cutoff = Math.round(Math.max(0, Math.min(255, c8)) * 0x7FF / 255);
      this._pokeFilter(vi, cutoff, p);
    } else {
      this._w(vi, 0x17, 0x00);
      this._w(vi, 0x18, (p.masterVolume & 0x0F));
    }
  }

  _pokeFilter(chip, cutoff, p) {
    // Route only the channels that sound: ch0 always, the layer (ch1) and an
    // audible osc2 (ch2) when on. A silent channel adds nothing but its DC
    // offset, so routing all three tripled the level step of switching the
    // filter on.
    const route = 0x01 | (p.layerOn ? 0x02 : 0) | (p.osc2On ? 0x04 : 0);
    this._w(chip, 0x15, cutoff & 0x07);
    this._w(chip, 0x16, (cutoff >> 3) & 0xFF);
    this._w(chip, 0x17, ((p.filterReso & 0x0F) << 4) | route);
    this._w(chip, 0x18, (p.filterMode & 0x70) | (p.masterVolume & 0x0F));
  }

  // ─── GT2 Table Execution (50Hz) ─────────────────────────────────────────

  _executeWavetable(vi) {
    const v = this.voices[vi];
    const t = v.tbl;
    if (!t.waveActive || t.wavePtr === 0) return;

    for (let iter = 0; iter < 16; iter++) {
      const pos = t.wavePtr - 1;
      if (pos < 0 || pos >= 255) { t.waveActive = false; return; }
      const left = this.tables.ltable[0][pos];
      const right = this.tables.rtable[0][pos];

      if (left <= 0x0F) {
        // Delay
        if (t.wavetime < left) { t.wavetime++; return; }
        t.wavetime = 0;
        t.wavePtr++;
        this._tableNote(t, right);
        this._handleWaveJump(t);
        return;
      }
      else if (left < 0xE0) {
        // Waveform (0x10-0xDF) — write directly to SID control register
        this._poke(vi, 0, 0x04, left);
        t.wave = left;
        t.wavetime = 0;
        this._tableNote(t, right);
        t.wavePtr++;
        this._handleWaveJump(t);
        return;
      }
      else if (left >= 0xE0 && left <= 0xEF) {
        // Gate off waveform
        this._poke(vi, 0, 0x04, left & 0x0F);
        t.wavePtr++;
        this._handleWaveJump(t);
        return;
      }
      else if (left === 0xFF) {
        if (right === 0) { t.waveActive = false; return; }
        t.wavePtr = right; t.wavetime = 0;
        continue;
      }
      else { t.wavePtr++; this._handleWaveJump(t); return; }
    }
  }

  // GT2 wavetable note column: 00-5F up, 60-7F DOWN (-32..-1), 80 = keep,
  // 81-DF absolute (C#0..). 60-7F used to go UP 96-127 semitones and the
  // absolute notes were added to the played key.
  _tableNote(t, right) {
    if (right === 0x80) return;
    if (right < 0x80) { t.absNote = -1; t.tableNote = right <= 0x5F ? right : right - 0x80; }
    else { t.absNote = (right & 0x7F) + 12; t.tableNote = 0; }
  }

  _handleWaveJump(t) {
    const pos = t.wavePtr - 1;
    if (pos < 0 || pos >= 255) return;
    if (this.tables.ltable[0][pos] === 0xFF) {
      const target = this.tables.rtable[0][pos];
      if (target === 0) t.waveActive = false;
      else { t.wavePtr = target; t.wavetime = 0; }
    }
  }

  // Exact port of GT2 gplay.c PULSEEXEC (as in ../sid-synth): the jump is
  // checked every frame, a modulation step modulates on the frame it loads,
  // and the pointer advances when its time runs out. The previous version
  // spent an extra idle frame on every step.
  _executePulsetable(vi) {
    const t = this.voices[vi].tbl;
    if (!t.pulseActive || t.pulsePtr === 0) return;
    const L = this.tables.ltable[1], R = this.tables.rtable[1];
    const at = (ptr) => (ptr >= 1 && ptr <= 255) ? ptr - 1 : -1;

    let pos = at(t.pulsePtr);
    if (pos < 0) { t.pulseActive = false; return; }
    if (L[pos] === 0xFF) {
      t.pulsePtr = R[pos];
      pos = at(t.pulsePtr);
      if (pos < 0) { t.pulseActive = false; return; }
    }
    if (!t.pulsetime) {
      const left = L[pos];
      if (left >= 0x80) {
        // Set pulse (no modulation this frame)
        t.tablePulse = ((left & 0x0F) << 8) | R[pos];
        t.pulsePtr++;
      } else {
        t.pulsetime = left;
      }
    }
    if (t.pulsetime) {
      const speed = R[pos];
      t.tablePulse = (t.tablePulse + (speed < 0x80 ? speed : speed - 0x100)) & 0xFFF;
      if (--t.pulsetime === 0) t.pulsePtr++;
    }
    this._setPulse(vi, 0, t.tablePulse);
  }

  _executeFilterTable() {
    const g = this.gflt;
    if (g.ptr === 0) return;

    if (g.modTicks > 0) {
      g.modTicks--;
      g.cutoff8 = Math.max(0, Math.min(255, g.cutoff8 + g.modSpeed));
      return;
    }

    for (let iter = 0; iter < 10; iter++) {
      const pos = g.ptr - 1;
      if (pos < 0 || pos >= 255) { g.ptr = 0; return; }
      const left = this.tables.ltable[2][pos];
      const right = this.tables.rtable[2][pos];

      if (left === 0x00) {
        g.cutoff8 = right; g.ptr++;
        return;
      }
      else if (left >= 0x01 && left <= 0x7F) {
        g.modTicks = left;
        g.modSpeed = (right & 0x80) ? (right - 256) : right;
        g.ptr++;
        return;
      }
      else if (left >= 0x80 && left <= 0xFE) {
        // Set filter type/resonance on all chips
        const type = left & 0x70;
        const reso = (right >> 4) & 0x0F;
        this.params.filterMode = type;
        this.params.filterReso = reso;
        this.params.filterOn = true;
        g.ptr++;
        return;
      }
      else if (left === 0xFF) {
        if (right === 0) { g.ptr = 0; return; }
        g.ptr = right;
        continue;
      }
      else { g.ptr++; return; }
    }
  }

  // ─── Per-voice 50 Hz frame: tables, osc2 sweep, glide, filter envelope ──

  _voiceTick(i) {
    const p = this.params;
    const v = this.voices[i];
    // Delayed layer gate (flam / echo-blip): fires layerDelay frames late.
    if (v.active && v.layerPending > 0) {
      if (--v.layerPending === 0) this._gateOn(i, 1, v.layerCtrl);
    }
    if (v.active && this.tableEnabled) {
      this._executeWavetable(i);
      this._executePulsetable(i);
    }

    // === Osc2 pitch sweep (independent, simple decay) ===
    if (v.sweep > 0 && (p.osc2On || p.hardSync || p.ringMod)) {
      // Decay rate: 0=instant drop, 15=very slow
      // SID decay time table values mapped to per-tick decrements
      const decayRates = [255, 128, 64, 48, 32, 24, 20, 16, 12, 6, 3, 2, 1.5, 0.5, 0.3, 0.17];
      const rate = decayRates[Math.min(15, p.osc2SweepSpeed)];
      v.sweep = Math.max(0, v.sweep - rate);
    }
    // === Portamento ===
    if (v.glide) {
      v.glide = v.glide > 0 ? Math.max(0, v.glide - v.glideStep) : Math.min(0, v.glide + v.glideStep);
    }

    // === Filter envelope (frame-rate ADSR for cutoff modulation) ===
    const fe = this.fltEnvs[i];
    if (fe.stage !== 0) {
      const aNibble = (p.fltAd >> 4) & 0xF;
      const dNibble = p.fltAd & 0xF;
      const sLevel = ((p.fltSr >> 4) & 0xF) * 17;
      const rNibble = p.fltSr & 0xF;
      // Per-frame step for a full 0..255 run in the SID's own time for that
      // nibble. (The old hand-made tables ran 2-10x slower than the chip:
      // decay 9 took 1.7 s where the SID takes 750 ms.)
      const step = (ms) => Math.min(255, 255 * 20 / ms);

      switch (fe.stage) {
        case 1: // attack
          fe.level += step(SID_ATTACK_MS[aNibble]);
          if (fe.level >= 255) { fe.level = 255; fe.stage = 2; }
          break;
        case 2: // decay
          fe.level -= step(SID_DECAY_MS[dNibble]);
          if (fe.level <= sLevel) { fe.level = sLevel; fe.stage = 3; }
          break;
        case 3: fe.level = sLevel; break;
        case 4: // release
          fe.level -= step(SID_DECAY_MS[rNibble]);
          if (fe.level <= 0) { fe.level = 0; fe.stage = 0; }
          break;
      }
      fe.level = Math.max(0, Math.min(255, fe.level));
    }

    this._refreshFreqs(i);
    this._updateFilter(i);
  }

  // ─── Audio Processing ─────────────────────────────────────────────────────

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const outL = output[0], outR = output[1];
    const blockSize = outL.length;

    // Global 50 Hz frame: the (shared) filter table
    this.tickCounter += blockSize;
    while (this.tickCounter >= this.samplesPerTick) {
      this.tickCounter -= this.samplesPerTick;
      if (this.tableEnabled && this.gflt.ptr > 0) {
        this._executeFilterTable();
        for (let c = 0; c < NUM_CHIPS; c++) this._updateFilter(c);
      }
    }
    // Per-voice frames, phase-locked to each voice's note-on
    for (let i = 0; i < NUM_VOICES; i++) {
      const v = this.voices[i];
      v.tick += blockSize;
      while (v.tick >= this.samplesPerTick) {
        v.tick -= this.samplesPerTick;
        this._voiceTick(i);
      }
    }
    // Vibrato runs per 128-sample block (~375 Hz), not on the 50 Hz frame:
    // at 50 Hz a 5.7 Hz vibrato is a 9-step staircase. Galway's Wizball
    // player ran 4x per frame (CIA timer $11B7) for exactly this smoothness.
    const vp = this.params;
    if (vp.vibDepth > 0) {
      const w = 2 * Math.PI * (vp.vibRate || 0), depth = vp.vibDepth / 100, delay = vp.vibDelay || 0;
      for (let i = 0; i < NUM_VOICES; i++) {
        const v = this.voices[i];
        if (!v.played) continue;
        v.age += blockSize;
        const t = v.age / sampleRate - delay;
        const vib = t > 0 ? depth * Math.sin(w * t) : 0;
        if (vib !== v.vib) { v.vib = vib; this._refreshFreqs(i); }
      }
    } else {
      // Depth turned to 0 mid-note: drop the offset rather than freeze it.
      for (let i = 0; i < NUM_VOICES; i++) {
        const v = this.voices[i];
        if (v.vib !== 0) { v.vib = 0; this._refreshFreqs(i); }
      }
    }

    // Generate audio from all 3 SID chips and mix.
    //
    // Previously each chip was pre-divided by 3 to guard the worst case of
    // all three playing loud — which left a solo voice ~13 dB quieter than
    // the other synths in the studio. Full gain with a soft clip on the sum
    // keeps single notes healthy and rounds off the rare loud tutti instead
    // of pre-emptively strangling everything.
    if (this._mixBuf.length !== blockSize) { this._mixBuf = new Float32Array(blockSize); this._chipBuf = new Array(blockSize); }
    const mix = this._mixBuf, buf = this._chipBuf;
    mix.fill(0);
    for (let c = 0; c < NUM_CHIPS; c++) {
      if (this._idle[c] >= IDLE_SAMPLES) {
        const h = this._hold[c];
        for (let s = 0; s < blockSize; s++) mix[s] += h;
        continue;
      }
      this.sids[c].generateIntoBuffer(blockSize, buf, 0);
      for (let s = 0; s < blockSize; s++) mix[s] += buf[s];
      this._hold[c] = buf[blockSize - 1];
      const vs = this.sids[c].voice;
      const silent = !this.voices[c].active &&
        vs[0].envelope.envelope_counter === 0 && vs[1].envelope.envelope_counter === 0 &&
        vs[2].envelope.envelope_counter === 0;
      this._idle[c] = silent ? this._idle[c] + blockSize : 0;
    }
    // SAMPLE_AVERAGE's triangular kernel rolls the top octave off (-1.3 dB
    // at 10 kHz, -4.5 dB at 19 kHz, on top of the C64's own 16 kHz output
    // filter). A 3-tap symmetric shelf gives most of it back.
    const a = 0.14, d = this._droop;
    // DC blocker, then soft clip. A pulse wave's mean level follows its duty
    // cycle, so a PWM sweep rides on a moving DC pedestal — and the gate step
    // adds a thump. The real C64 strips this with its output coupling cap;
    // without the blocker the DC shifts the tanh's operating point and the
    // sweep distorts asymmetrically. (~15 Hz highpass.)
    if (!this._dcPrimed) {
      // Prime the blocker with the first real sample so the power-on DC level
      // enters as "always was" rather than as a step.
      this._dcX = mix[0];
      d[0] = d[1] = mix[0];
      this._dcPrimed = true;
    }
    const R = this._dcR, ramp = this._rampLen;
    for (let s = 0; s < blockSize; s++) {
      const xin = mix[s];
      const x = (1 + 2 * a) * d[1] - a * (d[0] + xin);
      d[0] = d[1]; d[1] = xin;
      const y = x - this._dcX + R * this._dcY;
      this._dcX = x;
      this._dcY = y;
      let v = Math.tanh(y * 1.4);
      if (this._warmup > 0) {
        this._warmup--;
        const w = this._warmup > ramp ? 0 : 1 - this._warmup / ramp;
        v *= w;                        // mute, then a 50 ms ramp in
      }
      outL[s] = v;
      outR[s] = v;
    }

    return true;
  }
}

registerProcessor('sid-synth-processor', SIDSynthProcessor);
