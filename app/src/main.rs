// Copyright 2025 a7mddra
// SPDX-License-Identifier: Apache-2.0

//! OCR Engine GUI - Tauri application entry point.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gui_lib::run()
}
