import '@testing-library/jest-dom/vitest'

// jsdom lacks these; the app only needs them to exist.
if (!window.HTMLElement.prototype.scrollIntoView) window.HTMLElement.prototype.scrollIntoView = () => {}
window.confirm = () => true
