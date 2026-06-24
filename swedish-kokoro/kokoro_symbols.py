"""Authoritative Kokoro-82M symbol table (from hexgrad/Kokoro-82M config.json).

CRITICAL: Kokoro's vocab maps 114 symbols onto SPARSE indices inside a 178-slot
embedding space (e.g. a=43, ʂ=130, ː=158). StyleTTS2's default TextCleaner builds
a DENSE 0..N map -> wrong token ids -> NaN losses. This file reproduces the exact
config['vocab'] mapping so training uses the same ids the pretrained weights expect.

Interface matches the kikiri recipe: `from kokoro_symbols import symbols, dicts, TextCleaner`.
"""

n_token = 178  # embedding size (config["n_token"])

# symbol -> token id (exactly config["vocab"], 114 entries at sparse indices)
dicts = {
    ';': 1,
    ':': 2,
    ',': 3,
    '.': 4,
    '!': 5,
    '?': 6,
    '—': 9,
    '…': 10,
    '"': 11,
    '(': 12,
    ')': 13,
    '“': 14,
    '”': 15,
    ' ': 16,
    '̃': 17,
    'ʣ': 18,
    'ʥ': 19,
    'ʦ': 20,
    'ʨ': 21,
    'ᵝ': 22,
    'ꭧ': 23,
    'A': 24,
    'I': 25,
    'O': 31,
    'Q': 33,
    'S': 35,
    'T': 36,
    'W': 39,
    'Y': 41,
    'ᵊ': 42,
    'a': 43,
    'b': 44,
    'c': 45,
    'd': 46,
    'e': 47,
    'f': 48,
    'h': 50,
    'i': 51,
    'j': 52,
    'k': 53,
    'l': 54,
    'm': 55,
    'n': 56,
    'o': 57,
    'p': 58,
    'q': 59,
    'r': 60,
    's': 61,
    't': 62,
    'u': 63,
    'v': 64,
    'w': 65,
    'x': 66,
    'y': 67,
    'z': 68,
    'ɑ': 69,
    'ɐ': 70,
    'ɒ': 71,
    'æ': 72,
    'β': 75,
    'ɔ': 76,
    'ɕ': 77,
    'ç': 78,
    'ɖ': 80,
    'ð': 81,
    'ʤ': 82,
    'ə': 83,
    'ɚ': 85,
    'ɛ': 86,
    'ɜ': 87,
    'ɟ': 90,
    'ɡ': 92,
    'ɥ': 99,
    'ɨ': 101,
    'ɪ': 102,
    'ʝ': 103,
    'ɯ': 110,
    'ɰ': 111,
    'ŋ': 112,
    'ɳ': 113,
    'ɲ': 114,
    'ɴ': 115,
    'ø': 116,
    'ɸ': 118,
    'θ': 119,
    'œ': 120,
    'ɹ': 123,
    'ɾ': 125,
    'ɻ': 126,
    'ʁ': 128,
    'ɽ': 129,
    'ʂ': 130,
    'ʃ': 131,
    'ʈ': 132,
    'ʧ': 133,
    'ʊ': 135,
    'ʋ': 136,
    'ʌ': 138,
    'ɣ': 139,
    'ɤ': 140,
    'χ': 142,
    'ʎ': 143,
    'ʒ': 147,
    'ʔ': 148,
    'ˈ': 156,
    'ˌ': 157,
    'ː': 158,
    'ʰ': 162,
    'ʲ': 164,
    '↓': 169,
    '→': 171,
    '↗': 172,
    '↘': 173,
    'ᵻ': 177,
}
VOCAB = dicts  # alias

# index -> symbol, length == n_token (178); unused slots are empty strings
symbols = ['', ';', ':', ',', '.', '!', '?', '', '', '—', '…', '"', '(', ')', '“', '”', ' ', '̃', 'ʣ', 'ʥ', 'ʦ', 'ʨ', 'ᵝ', 'ꭧ', 'A', 'I', '', '', '', '', '', 'O', '', 'Q', '', 'S', 'T', '', '', 'W', '', 'Y', 'ᵊ', 'a', 'b', 'c', 'd', 'e', 'f', '', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ɑ', 'ɐ', 'ɒ', 'æ', '', '', 'β', 'ɔ', 'ɕ', 'ç', '', 'ɖ', 'ð', 'ʤ', 'ə', '', 'ɚ', 'ɛ', 'ɜ', '', '', 'ɟ', '', 'ɡ', '', '', '', '', '', '', 'ɥ', '', 'ɨ', 'ɪ', 'ʝ', '', '', '', '', '', '', 'ɯ', 'ɰ', 'ŋ', 'ɳ', 'ɲ', 'ɴ', 'ø', '', 'ɸ', 'θ', 'œ', '', '', 'ɹ', '', 'ɾ', 'ɻ', '', 'ʁ', 'ɽ', 'ʂ', 'ʃ', 'ʈ', 'ʧ', '', 'ʊ', 'ʋ', '', 'ʌ', 'ɣ', 'ɤ', '', 'χ', 'ʎ', '', '', '', 'ʒ', 'ʔ', '', '', '', '', '', '', '', 'ˈ', 'ˌ', 'ː', '', '', '', 'ʰ', '', 'ʲ', '', '', '', '', '↓', '', '→', '↗', '↘', '', '', '', 'ᵻ']
assert len(symbols) == n_token, (len(symbols), n_token)


class TextCleaner:
    """Map an IPA phoneme STRING to a list of Kokoro token ids.

    Unknown symbols raise (fail loud) so out-of-vocab phonemes never get silently
    dropped/zeroed during training. Run the corpus through g2p_sv (with KOKORO_REMAP)
    first so every symbol is representable.
    """
    def __init__(self, dummy=None):
        self.word_index_dictionary = dicts

    def __call__(self, text):
        out = []
        for ch in text:
            try:
                out.append(self.word_index_dictionary[ch])
            except KeyError:
                raise KeyError(
                    f"symbol {ch!r} (U+{ord(ch):04X}) not in Kokoro vocab; "
                    f"add a KOKORO_REMAP entry in g2p_sv.py")
        return out
