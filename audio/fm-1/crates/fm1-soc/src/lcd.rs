//! ST7789-class 240×240 panel model (FM-1: SPI1 on PC9 CLK/PC10 DO/PC7 CS/
//! PC8 D/C, backlight PA2 — wiring per Felucca hal/fm1_lcd_hw.h, protocol
//! per src/lcd.c). Maintains an RGB565 framebuffer; `fm1-emu` dumps BMPs.

pub const W: usize = 240;
pub const H: usize = 240;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// Expecting a command byte (D/C low).
    Cmd,
    /// Collecting `need` remaining data bytes for the pending command.
    Arg { need: u32 },
    /// Writing pixel data into the window (0x2C RAMWR stream).
    Pixel,
}

pub struct Lcd {
    pub fb: Vec<u16>,
    window: (u16, u16, u16, u16),
    cursor: (u16, u16),
    phase: Phase,
    cmd: u8,
    arg: [u8; 4],
    arg_next: usize,
    pixel_hi: Option<u8>,
    pub frames: u64,
    pub inverted: bool,
    pub display_on: bool,
}

impl Default for Lcd {
    fn default() -> Self {
        Self::new()
    }
}

impl Lcd {
    pub fn new() -> Self {
        Self {
            fb: vec![0x0000; W * H],
            window: (0, 0, (W as u16).wrapping_sub(1), (H as u16).wrapping_sub(1)),
            cursor: (0, 0),
            phase: Phase::Cmd,
            cmd: 0,
            arg: [0; 4],
            arg_next: 0,
            pixel_hi: None,
            frames: 0,
            inverted: false,
            display_on: false,
        }
    }

    /// One byte on the bus. `data` = D/C pin high.
    pub fn feed(&mut self, byte: u8, data: bool) {
        #[allow(unreachable_patterns)]
        match (self.phase, data) {
            (Phase::Cmd, false) => self.handle_cmd(byte),
            (Phase::Cmd, true) => self.pixel_byte(byte),
            (Phase::Arg { need }, true) => {
                if self.arg_next < 4 {
                    self.arg[self.arg_next] = byte;
                }
                self.arg_next += 1;
                if self.arg_next as u32 >= need {
                    self.take_args();
                    self.phase = Phase::Cmd;
                }
            }
            (Phase::Arg { .. }, false) => self.handle_cmd(byte),
            (Phase::Pixel, true) => self.pixel_byte(byte),
            (Phase::Pixel, false) => {
                self.phase = Phase::Cmd;
                self.handle_cmd(byte);
            }
        }
    }

    fn handle_cmd(&mut self, cmd: u8) {
        self.cmd = cmd;
        self.arg_next = 0;
        match cmd {
            0x2A | 0x2B => self.phase = Phase::Arg { need: 4 },
            0x36 | 0x3A => self.phase = Phase::Arg { need: 1 },
            0x2C => {
                self.cursor = (self.window.0, self.window.1);
                self.phase = Phase::Pixel;
                self.pixel_hi = None;
            }
            0x21 => self.inverted = true,
            0x22 => self.inverted = false,
            0x29 => self.display_on = true,
            0x28 => self.display_on = false,
            0x01 => {
                self.fb.fill(0x0000);
                self.display_on = false;
                self.inverted = false;
                self.frames += 1;
            }
            _ => {}
        }
    }

    fn take_args(&mut self) {
        match self.cmd {
            0x2A => {
                self.window.0 = u16::from_be_bytes([self.arg[0], self.arg[1]]);
                self.window.2 = u16::from_be_bytes([self.arg[2], self.arg[3]])
                    .min(W as u16 - 1);
            }
            0x2B => {
                self.window.1 = u16::from_be_bytes([self.arg[0], self.arg[1]]);
                self.window.3 = u16::from_be_bytes([self.arg[2], self.arg[3]])
                    .min(H as u16 - 1);
            }
            _ => {}
        }
    }

    fn push_pixel(&mut self, px: u16) {
        let (x0, y0, x1, y1) = self.window;
        if x0 > x1 || y0 > y1 {
            return;
        }
        let (x, y) = (self.cursor.0 as usize, self.cursor.1 as usize);
        if x < W && y < H {
            self.fb[y * W + x] = px;
        }
        // advance through the window
        if self.cursor.0 >= x1 {
            self.cursor.0 = x0;
            if self.cursor.1 >= y1 {
                self.cursor.1 = y0;
                self.frames += 1; // window complete
            } else {
                self.cursor.1 = self.cursor.1.saturating_add(1);
            }
        } else {
            self.cursor.0 = self.cursor.0.saturating_add(1);
        }
    }

    fn pixel_byte(&mut self, byte: u8) {
        match self.pixel_hi.take() {
            None => self.pixel_hi = Some(byte),
            Some(hi) => {
                let px = ((hi as u16) << 8) | byte as u16;
                self.push_pixel(px);
            }
        }
    }
}

/// Dump the framebuffer to a 24-bit BMP (RGB565 -> RGB888).
pub fn write_bmp(path: &str, fb: &[u16], inverted: bool) -> std::io::Result<()> {
    use std::io::Write;
    let w = W as u32;
    let h = H as u32;
    let row = (w * 3 + 3) & !3;
    let size = 54 + row * h;
    let f = std::io::BufWriter::new(std::fs::File::create(path)?);
    let mut f = f;
    f.write_all(&[b'B', b'M'])?;
    f.write_all(&size.to_le_bytes())?;
    f.write_all(&0u32.to_le_bytes())?;
    f.write_all(&54u32.to_le_bytes())?;
    f.write_all(&40u32.to_le_bytes())?;
    f.write_all(&w.to_le_bytes())?;
    f.write_all(&h.to_le_bytes())?;
    f.write_all(&1u16.to_le_bytes())?;
    f.write_all(&24u16.to_le_bytes())?;
    f.write_all(&0u32.to_le_bytes())?;
    f.write_all(&(row * h).to_le_bytes())?;
    f.write_all(&0u32.to_le_bytes())?;
    f.write_all(&0u32.to_le_bytes())?;
    f.write_all(&0u32.to_le_bytes())?;
    f.write_all(&0u32.to_le_bytes())?;
    let pad = [0u8; 3];
    let padlen = (W * 3) % 4;
    for y in (0..H).rev() {
        for x in 0..W {
            let mut rgb565 = fb[y * W + x];
            if inverted {
                rgb565 = !rgb565;
            }
            let r = ((((rgb565 >> 11) & 0x1f) as u32) * 255 / 31) as u8;
            let g = ((((rgb565 >> 5) & 0x3f) as u32) * 255 / 63) as u8;
            let b = (((rgb565 & 0x1f) as u32) * 255 / 31) as u8;
            f.write_all(&[b, g, r])?;
        }
        f.write_all(&pad[..(3 - padlen)])?;
    }
    Ok(())
}
