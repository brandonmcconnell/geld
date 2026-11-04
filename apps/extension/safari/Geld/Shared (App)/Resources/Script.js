function show(platform, enabled, useSettingsInsteadOfPreferences) {
    document.body.classList.add(`platform-${platform}`);

    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
    }
}

document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
        webkit.messageHandlers.controller.postMessage(button.dataset.action);
    });
});
