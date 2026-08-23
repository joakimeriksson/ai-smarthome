// UI scale. The C64 Pro Mono bitmap face is drawn for 8px, so every font-size
// in style.css is 8px -- authentic, but about a quarter of the physical size it
// had on a 1980s TV. Rather than rewrite 35 font sizes and the fixed px column
// widths that go with them, scale the whole page with `zoom`, which keeps the
// pixel font crisp at integer values and leaves the layout untouched.

const SCALES = ['1', '1.25', '1.5', '2'];
const DEFAULT_SCALE = '1.5';
const STORAGE_KEY = 'sidtracker.uiScale';

function apply(scale) {
    document.documentElement.style.setProperty('--ui-scale', scale);
}

function load() {
    // Private-mode browsers throw on localStorage rather than returning null.
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return SCALES.includes(saved) ? saved : DEFAULT_SCALE;
    } catch {
        return DEFAULT_SCALE;
    }
}

function save(scale) {
    try {
        localStorage.setItem(STORAGE_KEY, scale);
    } catch {
        // Not being able to remember the choice is not worth breaking over.
    }
}

const scale = load();
apply(scale);

window.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('uiScaleSelect');
    if (!select) return;
    select.value = scale;
    select.addEventListener('change', () => {
        apply(select.value);
        save(select.value);
    });
});
