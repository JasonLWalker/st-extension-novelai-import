// The main script for the extension
// The following are examples of some basic extension functionality

//You'll likely need to import extension_settings, getContext, and loadExtensionSettings from extensions.js
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";

//You'll likely need to import some other functions from the main script
import { saveSettingsDebounced, callPopup, eventSource, event_types } from "../../../../script.js";

import { NovelAiApi } from "./lib/novel-ai-api/novel-ai-api.js";

// Keep track of where your extension is located, name should match repo name
const extensionName = "st-extension-novelai-import";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];
const defaultSettings = {
    enabled: false
};
const novelApi = new NovelAiApi();

const _VERBOSE = true;
export const log = (...msg) => _VERBOSE ? console.log('[NAI Import]', ...msg) : null;
export const warn = (...msg) => _VERBOSE ? console.warn('[NAI Import]', ...msg) : null;
const indexHtml = await $.get(`${extensionFolderPath}/index.html`);
const loginHtml = await $.get(`${extensionFolderPath}/login.html`);
const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);

// Loads the extension settings if they exist, otherwise initializes them to the defaults.
async function loadSettings() {
    //Create the settings if they don't exist
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }

    // Updating settings in the UI
    $("#nai-import-enabled").prop("checked", extension_settings[extensionName].enabled).trigger("input");
}

// This function is called when the extension settings are changed in the UI
function onExampleInput(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].enabled = value;
    saveSettingsDebounced();
    enablePlugin(value);
}

function enablePlugin(enabled) {
    $('#nai_import_button').remove();
    if (enabled) {
        $('#character_import_button, #external_import_button').addClass('d-none');
        var $btn = $('<div id="nai_import_button" title="Import Character" data-i18n="[title]Import Character" class="menu_button fa-solid fa-cloud-arrow-down faSmallFontSquareFix"></div>')
        $('#rm_button_create').after($btn);
        $btn.on('click', onImportCharacterButton);
    } else {
        $('#character_import_button, #external_import_button').removeClass('d-none');
    }
}

function onOriginalCharacterImportButton() {
    $('#nai-import-index').closest('#dialogue_popup').find('#dialogue_popup_ok').trigger('click');
    $('#character_import_button').trigger('click');
}

function onOriginalExternalImportButton() {
    $('#nai-import-index').closest('#dialogue_popup').find('#dialogue_popup_ok').trigger('click');
    $('#external_import_button').trigger('click');
}

async function onImportCharacterButton(evt) {
    log('Import Character has fired');
    var popup = callPopup(indexHtml, 'text', '', {wide: true, large: true, allowHorizontalScrolling: true, okButton: 'Close'});
    var keys = novelApi['keys'];
    var $content = $("#nai-import-index .content-main");

    if (!keys['accessToken'] || !keys['encryptionKey']) {
        log('Not Logged in. Logging in to NovelAI');
        $content.empty();
        $content.append(loginHtml);
        $('#nai-import-login button[name=nai-login]').off().on('click', async function(){
            await novelApi.login(
                $('#nai-import-login input[name=nai-username]').val(), 
                $('#nai-import-login input[name=nai-username]').val()
            );
            
        });
    }

    popup.then(function(evt){
        log('Popup has been closed');
    });
    $('#nai-import-index .orig_character_import_button').off().on('click', onOriginalCharacterImportButton);
    $('#nai-import-index .orig_external_import_button').off().on('click', onOriginalExternalImportButton);
}

// This function is called when the button is clicked
function onButtonClick() {
    // You can do whatever you want here
    // Let's make a popup appear with the checked setting
    toastr.info(
        `The checkbox is ${extension_settings[extensionName].example_setting ? "checked" : "not checked"}`,
        "A popup appeared because you clicked the button!"
    );
}

function handleIncomingMessage(data) {
    // Handle message
    log(data);
}

// This function is called when the extension is loaded
jQuery(async () => {
    // This is an example of loading HTML from a file

    enablePlugin(extensionSettings['enabled'])

    // Append settingsHtml to extensions_settings
    // extension_settings and extensions_settings2 are the left and right columns of the settings menu
    // Left should be extensions that deal with system functions and right should be visual/UI related 
    $("#extensions_settings").append(settingsHtml);

    // These are examples of listening for events
    $("#my_button").on("click", onButtonClick);
    $("#nai-import-enabled").on("input", onExampleInput);

    // Load settings when starting things up (if you have any)
    loadSettings();
});
