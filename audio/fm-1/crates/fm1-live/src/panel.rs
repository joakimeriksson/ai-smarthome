//! The FM-1 front panel, drawn after Felucca's controls diagram
//! (reference/Felucca/docs/controls.jpg): MASTER / SELECT / PRESETS /
//! ALGORITHM top left with OCT- / OCT+ under them, the screen in the
//! middle, KNOB1-4 and two rows of six buttons on the right, and the 27
//! pill keys (F3..G5) across the bottom.

pub const W: usize = 1280;
pub const H: usize = 820;
pub const LCD_X: usize = 370;
pub const LCD_Y: usize = 42;

const ROOM: u32 = 0x18191b;
const BODY_TOP: u32 = 0x5e6166;
const BODY_BOT: u32 = 0x4a4d52;
const TRAY: u32 = 0x2b2c2f;
const SILK: u32 = 0xc9c6bd;
const BTN_TOP: u32 = 0x4b4e54;
const BTN_BOT: u32 = 0x3b3d42;
const BTN_INK: u32 = 0x9c9a94;
const KEY_TOP: u32 = 0x6a5557;
const KEY_BOT: u32 = 0x4f3f42;
const KEY_LINE: u32 = 0x8f7c7e;
const AMBER: u32 = 0xf2a33a;
const GREEN: u32 = 0x62d36e;

/// What a point on the panel is.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Ctl {
    /// An encoder: index into `ENCS`.
    Enc(usize),
    /// The MASTER pot (SARADC ch 4).
    Pot,
    /// A button: its matrix key id (0..13).
    Btn(u8),
    /// A note key: its matrix key id (14..40).
    Key(u8),
}

/// Encoders: (label, matrix encoder, centre x, centre y, radius).
pub const ENCS: [(&str, u8, f32, f32, f32); 7] = [
    ("SELECT", 0, 250.0, 135.0, 44.0),
    ("PRESETS", 6, 110.0, 295.0, 44.0),
    ("ALGORITHM", 1, 250.0, 295.0, 44.0),
    ("KNOB1", 2, 935.0, 120.0, 36.0),
    ("KNOB2", 3, 1027.0, 120.0, 36.0),
    ("KNOB3", 4, 1119.0, 120.0, 36.0),
    ("KNOB4", 5, 1211.0, 120.0, 36.0),
];
pub const POT: (f32, f32, f32) = (110.0, 135.0, 44.0);

/// Buttons: (label, matrix id, x, y, w, h).
pub fn buttons() -> Vec<(&'static str, u8, usize, usize, usize, usize)> {
    let mut v = vec![("OCT-", 0, 62, 398, 112, 44), ("OCT+", 1, 186, 398, 112, 44)];
    let rows: [[(&str, u8); 6]; 2] = [
        [("FX", 2), ("SCL", 3), ("ENV", 4), ("LFO", 5), ("EDIT", 6), ("GLO", 7)],
        [("HOME", 8), ("SAVE", 9), ("ARP", 10), ("SEQ", 11), ("PLAY", 12), ("REC", 13)],
    ];
    for (r, row) in rows.iter().enumerate() {
        for (i, (name, id)) in row.iter().enumerate() {
            v.push((*name, *id, 906 + i * 58, 232 + r * 76, 50, 64));
        }
    }
    v
}

/// Note keys: (matrix id, x, y, w, h, black).
pub fn keys() -> Vec<(u8, usize, usize, usize, usize, bool)> {
    let (kw, gap, x0) = (62usize, 11usize, 61usize);
    let mut v = Vec::new();
    // F3..G5: the white keys are F G A B C D E F G A B C D E F G
    let whites = [0u8, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26];
    for (i, n) in whites.iter().enumerate() {
        v.push((14 + n, x0 + i * (kw + gap), 680, kw, 106, false));
    }
    // a black key sits over the gap after white key i
    let blacks = [(1u8, 0usize), (3, 1), (5, 2), (8, 4), (10, 5), (13, 7), (15, 8), (17, 9), (20, 11), (22, 12), (25, 14)];
    for (n, after) in blacks {
        let cx = x0 + (after + 1) * (kw + gap) - gap / 2;
        v.push((14 + n, cx - kw / 2, 574, kw, 94, true));
    }
    v
}

pub fn hit(x: f32, y: f32) -> Option<Ctl> {
    for (i, (_, _, cx, cy, r)) in ENCS.iter().enumerate() {
        if (x - cx).powi(2) + (y - cy).powi(2) <= (r + 6.0).powi(2) {
            return Some(Ctl::Enc(i));
        }
    }
    if (x - POT.0).powi(2) + (y - POT.1).powi(2) <= (POT.2 + 6.0).powi(2) {
        return Some(Ctl::Pot);
    }
    let inside = |px: usize, py: usize, w: usize, h: usize| x >= px as f32 && x < (px + w) as f32 && y >= py as f32 && y < (py + h) as f32;
    for (_, id, px, py, w, h) in buttons() {
        if inside(px, py, w, h) {
            return Some(Ctl::Btn(id));
        }
    }
    // black keys first: they sit above the white row
    let mut ks = keys();
    ks.sort_by_key(|k| !k.5);
    for (id, px, py, w, h, _) in ks {
        if inside(px, py, w, h) {
            return Some(Ctl::Key(id));
        }
    }
    None
}

// ---------------------------------------------------------------- drawing --

fn mix(a: u32, b: u32, t: f32) -> u32 {
    let t = t.clamp(0.0, 1.0);
    let ch = |s: u32| -> u32 {
        let x = ((a >> s) & 255) as f32;
        let y = ((b >> s) & 255) as f32;
        ((x + (y - x) * t).round() as u32) << s
    };
    ch(16) | ch(8) | ch(0)
}

fn put(buf: &mut [u32], x: i32, y: i32, c: u32, a: f32) {
    if x >= 0 && y >= 0 && (x as usize) < W && (y as usize) < H && a > 0.0 {
        let p = &mut buf[y as usize * W + x as usize];
        *p = mix(*p, c, a);
    }
}

/// Rounded rectangle with a vertical gradient, anti-aliased edges.
fn rrect(buf: &mut [u32], x: f32, y: f32, w: f32, h: f32, r: f32, top: u32, bot: u32) {
    for py in (y.floor() as i32 - 1)..=((y + h).ceil() as i32) {
        for px in (x.floor() as i32 - 1)..=((x + w).ceil() as i32) {
            let (fx, fy) = (px as f32 + 0.5, py as f32 + 0.5);
            let qx = (fx - (x + w / 2.0)).abs() - (w / 2.0 - r);
            let qy = (fy - (y + h / 2.0)).abs() - (h / 2.0 - r);
            let d = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt() + qx.max(qy).min(0.0) - r;
            let a = (0.5 - d).clamp(0.0, 1.0);
            if a > 0.0 {
                put(buf, px, py, mix(top, bot, (fy - y) / h), a);
            }
        }
    }
}

fn disc(buf: &mut [u32], cx: f32, cy: f32, r: f32, f: impl Fn(f32, f32) -> u32) {
    for py in (cy - r - 1.0) as i32..=(cy + r + 1.0) as i32 {
        for px in (cx - r - 1.0) as i32..=(cx + r + 1.0) as i32 {
            let (dx, dy) = (px as f32 + 0.5 - cx, py as f32 + 0.5 - cy);
            let d = (dx * dx + dy * dy).sqrt();
            let a = (r - d + 0.5).clamp(0.0, 1.0);
            if a > 0.0 {
                put(buf, px, py, f(dx, dy), a);
            }
        }
    }
}

/// 5x7 glyphs, one byte per column, bit 0 at the top.
fn glyph(c: char) -> [u8; 5] {
    match c {
        '0' => [0x3E, 0x51, 0x49, 0x45, 0x3E], '1' => [0x00, 0x42, 0x7F, 0x40, 0x00],
        '2' => [0x42, 0x61, 0x51, 0x49, 0x46], '3' => [0x21, 0x41, 0x45, 0x4B, 0x31],
        '4' => [0x18, 0x14, 0x12, 0x7F, 0x10], '5' => [0x27, 0x45, 0x45, 0x45, 0x39],
        '6' => [0x3C, 0x4A, 0x49, 0x49, 0x30], '7' => [0x01, 0x71, 0x09, 0x05, 0x03],
        '8' => [0x36, 0x49, 0x49, 0x49, 0x36], '9' => [0x06, 0x49, 0x49, 0x29, 0x1E],
        'A' => [0x7E, 0x11, 0x11, 0x11, 0x7E], 'B' => [0x7F, 0x49, 0x49, 0x49, 0x36],
        'C' => [0x3E, 0x41, 0x41, 0x41, 0x22], 'D' => [0x7F, 0x41, 0x41, 0x22, 0x1C],
        'E' => [0x7F, 0x49, 0x49, 0x49, 0x41], 'F' => [0x7F, 0x09, 0x09, 0x09, 0x01],
        'G' => [0x3E, 0x41, 0x49, 0x49, 0x7A], 'H' => [0x7F, 0x08, 0x08, 0x08, 0x7F],
        'I' => [0x00, 0x41, 0x7F, 0x41, 0x00], 'J' => [0x20, 0x40, 0x41, 0x3F, 0x01],
        'K' => [0x7F, 0x08, 0x14, 0x22, 0x41], 'L' => [0x7F, 0x40, 0x40, 0x40, 0x40],
        'M' => [0x7F, 0x02, 0x0C, 0x02, 0x7F], 'N' => [0x7F, 0x04, 0x08, 0x10, 0x7F],
        'O' => [0x3E, 0x41, 0x41, 0x41, 0x3E], 'P' => [0x7F, 0x09, 0x09, 0x09, 0x06],
        'Q' => [0x3E, 0x41, 0x51, 0x21, 0x5E], 'R' => [0x7F, 0x09, 0x19, 0x29, 0x46],
        'S' => [0x46, 0x49, 0x49, 0x49, 0x31], 'T' => [0x01, 0x01, 0x7F, 0x01, 0x01],
        'U' => [0x3F, 0x40, 0x40, 0x40, 0x3F], 'V' => [0x1F, 0x20, 0x40, 0x20, 0x1F],
        'W' => [0x3F, 0x40, 0x38, 0x40, 0x3F], 'X' => [0x63, 0x14, 0x08, 0x14, 0x63],
        'Y' => [0x07, 0x08, 0x70, 0x08, 0x07], 'Z' => [0x61, 0x51, 0x49, 0x45, 0x43],
        '+' => [0x08, 0x08, 0x3E, 0x08, 0x08], '-' => [0x08, 0x08, 0x08, 0x08, 0x08],
        '/' => [0x20, 0x10, 0x08, 0x04, 0x02], '.' => [0x00, 0x60, 0x60, 0x00, 0x00],
        _ => [0; 5],
    }
}

/// Text centred on cx, `scale` pixels per font dot.
pub fn text(buf: &mut [u32], cx: f32, y: f32, s: &str, scale: usize, color: u32) {
    let adv = 6 * scale;
    let x0 = cx as i32 - (s.len() * adv) as i32 / 2 + scale as i32 / 2;
    for (i, c) in s.chars().enumerate() {
        for (gx, col) in glyph(c.to_ascii_uppercase()).iter().enumerate() {
            for gy in 0..7 {
                if col >> gy & 1 != 0 {
                    for sy in 0..scale {
                        for sx in 0..scale {
                            let px = x0 + (i * adv + gx * scale + sx) as i32;
                            let py = y as i32 + (gy * scale + sy) as i32;
                            put(buf, px, py, color, 1.0);
                        }
                    }
                }
            }
        }
    }
}

/// The parts that never change: body, trays, bezel, labels.
pub fn base() -> Vec<u32> {
    let mut b = vec![ROOM; W * H];
    rrect(&mut b, 14.0, 14.0, (W - 28) as f32, (H - 28) as f32, 30.0, BODY_TOP, BODY_BOT);
    // screen bezel
    rrect(&mut b, 352.0, 24.0, 516.0, 516.0, 22.0, 0x0e0e10, 0x0b0b0c);
    // OCT tray, button tray, keyboard tray
    rrect(&mut b, 50.0, 388.0, 260.0, 64.0, 14.0, TRAY, TRAY);
    rrect(&mut b, 896.0, 222.0, 360.0, 160.0, 16.0, TRAY, TRAY);
    rrect(&mut b, 34.0, 562.0, 1212.0, 236.0, 26.0, 0x2f2f33, 0x27272a);
    // knob labels
    text(&mut b, POT.0, POT.1 - POT.2 - 24.0, "MASTER", 2, SILK);
    for (name, _, cx, cy, r) in ENCS.iter() {
        text(&mut b, *cx, cy - r - 24.0, name, 2, SILK);
    }
    // PLAY / REC outlined, as on the panel
    rrect(&mut b, 1134.0, 302.0, 112.0, 72.0, 10.0, 0x3c6b43, 0x3c6b43);
    rrect(&mut b, 1136.0, 304.0, 108.0, 68.0, 9.0, TRAY, TRAY);
    text(&mut b, 640.0, 552.0 - 2.0, "FM-1  FELUCCA", 1, 0x8c8a85);
    b
}

fn knob(buf: &mut [u32], cx: f32, cy: f32, r: f32, angle: f32, glow: f32) {
    // shadow, knurled skirt, cap, pointer
    disc(buf, cx + 2.0, cy + 4.0, r + 2.0, |_, _| 0x26272a);
    if glow > 0.0 {
        disc(buf, cx, cy, r + 4.0, |_, _| mix(0x2a2b2e, AMBER, glow * 0.8));
    }
    disc(buf, cx, cy, r, |dx, dy| {
        let a = dy.atan2(dx);
        let ridge = ((a * 18.0).sin() * 0.5 + 0.5) * 0.25;
        mix(0x2e3034, 0x50535a, ridge + (-dy / r) * 0.2 + 0.2)
    });
    disc(buf, cx, cy, r * 0.72, |dx, dy| {
        let l = (-(dx + dy) / (r * 1.2)).clamp(-1.0, 1.0) * 0.5 + 0.5;
        mix(0x3a3d43, 0x6d7178, l)
    });
    let (s, c) = angle.sin_cos();
    for t in 0..((r * 0.62) as i32) {
        let d = r * 0.12 + t as f32;
        let (px, py) = (cx + s * d, cy - c * d);
        disc(buf, px, py, 1.6, |_, _| 0xeeeae2);
    }
}

pub struct State<'a> {
    pub lcd: &'a [u16],
    pub enc_clicks: &'a [i32; 7],
    pub pot: u16,
    pub down: &'a [bool; 41],
    pub leds: &'a [f32; 41],
    pub turning: &'a [u32; 8],
}

/// LED fraction -> brightness: a fully lit LED is on ~1 tick in 11.
fn bright(f: f32) -> f32 {
    (f / 0.08).clamp(0.0, 1.0)
}

pub fn draw(buf: &mut [u32], base: &[u32], st: &State) {
    buf.copy_from_slice(base);
    // the LCD at 2x
    for y in 0..240 {
        for x in 0..240 {
            let p = st.lcd[y * 240 + x] as u32;
            let c = ((p >> 11) * 255 / 31) << 16 | (((p >> 5) & 63) * 255 / 63) << 8 | (p & 31) * 255 / 31;
            let o = (LCD_Y + 2 * y) * W + LCD_X + 2 * x;
            buf[o] = c;
            buf[o + 1] = c;
            buf[o + W] = c;
            buf[o + W + 1] = c;
        }
    }
    // knobs: encoders turn 18 degrees a click; the pot sweeps 270 degrees
    for (i, (_, _, cx, cy, r)) in ENCS.iter().enumerate() {
        let glow = (st.turning[i] as f32 / 10.0).min(1.0);
        knob(buf, *cx, *cy, *r, (st.enc_clicks[i] as f32 * 18.0).to_radians(), glow);
    }
    let pa = (-135.0 + 270.0 * st.pot as f32 / 1023.0).to_radians();
    knob(buf, POT.0, POT.1, POT.2, pa, (st.turning[7] as f32 / 10.0).min(1.0));
    // buttons: pressed sinks, LED tints the cap
    for (name, id, x, y, w, h) in buttons() {
        let down = st.down[id as usize];
        let led = bright(st.leds[id as usize]);
        let tint = if id == 12 { GREEN } else { AMBER };
        let off = if down { 2.0 } else { 0.0 };
        rrect(buf, x as f32 + 1.0, y as f32 + 3.0, w as f32, h as f32, 9.0, 0x1c1d20, 0x1c1d20);
        let (top, bot) = (mix(BTN_TOP, tint, led * 0.85), mix(BTN_BOT, tint, led * 0.7));
        rrect(buf, x as f32, y as f32 + off, w as f32, h as f32, 9.0, top, bot);
        let ink = if led > 0.5 { 0x2a1a03 } else { BTN_INK };
        text(buf, (x + w / 2) as f32, (y + h / 2) as f32 - 7.0 + off, name, 2, ink);
    }
    // note keys: pills with a ridge; pressed and lit keys glow
    for (id, x, y, w, h, _) in keys() {
        let down = st.down[id as usize];
        let led = bright(st.leds[id as usize]);
        let off = if down { 3.0 } else { 0.0 };
        rrect(buf, x as f32 + 1.0, y as f32 + 4.0, w as f32, h as f32, w as f32 / 2.0, 0x1a1a1c, 0x1a1a1c);
        let heat = if down { 0.55 } else { led * 0.6 };
        rrect(buf, x as f32, y as f32 + off, w as f32, h as f32, w as f32 / 2.0, mix(KEY_TOP, AMBER, heat), mix(KEY_BOT, AMBER, heat * 0.8));
        let line = mix(KEY_LINE, 0xffe2b0, if down { 1.0 } else { led });
        rrect(buf, (x + w / 2) as f32 - 2.5, y as f32 + 18.0 + off, 5.0, h as f32 - 36.0, 2.5, line, line);
    }
}
