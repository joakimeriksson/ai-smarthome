//! GDB remote stub for the FM-1 emulator (PLAN.md Phase 5).
//!
//! Placeholder crate. Implementation lands once the core can execute real
//! instructions — until then there is nothing useful to debug. Plan: use the
//! `gdbstub` crate with a `Target` impl wrapping `fm1_core::Cpu` + the SoC bus.
