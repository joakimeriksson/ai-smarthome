//! Plain little-endian RAM region at address 0.

pub struct Ram {
    data: Vec<u8>,
}

impl Ram {
    pub fn new(size: usize) -> Self {
        Self {
            data: vec![0; size],
        }
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Host pointer to the bytes (the JIT's inline loads and stores).
    pub fn as_mut_ptr(&mut self) -> *mut u8 {
        self.data.as_mut_ptr()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn read8(&self, addr: u32) -> u8 {
        self.data[addr as usize]
    }

    pub fn read16(&self, addr: u32) -> u16 {
        let a = addr as usize;
        u16::from_le_bytes([self.data[a], self.data[a + 1]])
    }

    pub fn read32(&self, addr: u32) -> u32 {
        let a = addr as usize;
        u32::from_le_bytes([
            self.data[a],
            self.data[a + 1],
            self.data[a + 2],
            self.data[a + 3],
        ])
    }

    pub fn write8(&mut self, addr: u32, value: u8) {
        self.data[addr as usize] = value;
    }

    pub fn write16(&mut self, addr: u32, value: u16) {
        let a = addr as usize;
        self.data[a..a + 2].copy_from_slice(&value.to_le_bytes());
    }

    pub fn write32(&mut self, addr: u32, value: u32) {
        let a = addr as usize;
        self.data[a..a + 4].copy_from_slice(&value.to_le_bytes());
    }

    /// Load raw bytes at an offset (firmware loading).
    pub fn load(&mut self, offset: u32, bytes: &[u8]) {
        let o = offset as usize;
        self.data[o..o + bytes.len()].copy_from_slice(bytes);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_all_widths() {
        let mut ram = Ram::new(64);
        ram.write32(0, 0xDEAD_BEEF);
        assert_eq!(ram.read32(0), 0xDEAD_BEEF);
        assert_eq!(ram.read16(0), 0xBEEF);
        assert_eq!(ram.read8(1), 0xBE);
        ram.write16(8, 0x1234);
        assert_eq!(ram.read8(8), 0x34);
        assert_eq!(ram.read8(9), 0x12);
    }
}
