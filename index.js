// The main script for the extension
// The following are examples of some basic extension functionality

//You'll likely need to import extension_settings, getContext, and loadExtensionSettings from extensions.js
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";

//You'll likely need to import some other functions from the main script
import { 
    saveSettingsDebounced, 
    callPopup, 
    select_rm_info, 
    is_send_press, 
    this_chid,
    getCharacters,
    characters,
    eventSource, 
    event_types 
} from "../../../../script.js";

import { is_group_generating } from "../../../../scripts/group-chats.js";
import { power_user } from "../../../../scripts/power-user.js";
import { importTags } from "../../../../scripts/tags.js";

import { NovelAiApi, API_NOVELAI, IMAGE_NOVELAI } from "./lib/novel-ai-api/novel-ai-api.js";
import './lib/meta-png/dist/meta-png.umd.js'

// Keep track of where your extension is located, name should match repo name
const extensionName = "st-extension-novelai-import";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const defaultSettings = {
    enabled: false,
    passthroughEnabled: false
};

const novelApi = new NovelAiApi();

const _VERBOSE = true;
export const log = (...msg) => _VERBOSE ? console.log('[NAI Import]', ...msg) : null;
export const warn = (...msg) => _VERBOSE ? console.warn('[NAI Import]', ...msg) : null;
const indexHtml = await $.get(`${extensionFolderPath}/index.html`);
const chooseImageHtml = await $.get(`${extensionFolderPath}/chooseimage.html`);
const loginHtml = await $.get(`${extensionFolderPath}/login.html`);
const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
var novelAiEndpoint = API_NOVELAI;

// Loads the extension settings if they exist, otherwise initializes them to the defaults.
async function loadSettings() {
    //Create the settings if they don't exist
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }

    const extensionSettings = extension_settings[extensionName];

    // Updating settings in the UI
    $("#nai-import-enabled").prop("checked", extensionSettings['enabled']);
    $("#nai-import-passthrough-enabled").prop("checked", extensionSettings['passthroughEnabled']);

    enablePlugin(extensionSettings['enabled']);
    if (extensionSettings['passthroughEnabled'])
        novelApi.setApiEndpoint(`/api/plugins/novelai-passthrough`);
    else
        novelApi.setApiEndpoint(API_NOVELAI);

}


// This function is called when the extension settings are changed in the UI
function onSettingsEnablePlugin(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].enabled = value;
    saveSettingsDebounced();
    enablePlugin(value);
}

function onSettingsEnablePassthrough(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].passthroughEnabled = value;
    saveSettingsDebounced();
    if (value)
        novelApi.setApiEndpoint(`/api/plugins/novelai-passthrough`);
    else
        novelApi.setApiEndpoint(API_NOVELAI);
}



function enablePlugin(enabled) {
    // remove any existing plugin button
    $('#nai_import_button').remove();

    if (enabled) {
        // Hide original import buttons
        $('#character_import_button, #external_import_button').addClass('d-none');

        // Create new plugin button and append to UI
        var $btn = $('<div id="nai_import_button" title="Import Character" data-i18n="[title]Import Character" class="menu_button fa-solid fa-cloud-arrow-down faSmallFontSquareFix"></div>')
        $('#rm_button_create').after($btn);

        // Add button event handler
        $btn.on('click', onImportCharacterButton);
    } else {
        // Show original import buttons
        $('#character_import_button, #external_import_button').removeClass('d-none');
    }
}


function onOriginalCharacterImportButton() {
    // Close dialog box
    $('#nai-import-index').closest('#dialogue_popup').find('#dialogue_popup_ok').trigger('click');
    // Trigger original import handler
    $('#character_import_button').trigger('click');
}

function onOriginalExternalImportButton() {
    // Close dialog box
    $('#nai-import-index').closest('#dialogue_popup').find('#dialogue_popup_ok').trigger('click');
    // Trigger original external import handler
    $('#external_import_button').trigger('click');
}

async function tryLogin() {
    // Retrieve NovelAi keys from API
    var keys = novelApi['keys'];
    var extensionSettings = extension_settings[extensionName];

    // Does an access token and encryption key exist from a previous login session?
    if (extensionSettings['accessToken'] && extensionSettings['encryptionKey']) {
        // Try populating the keystore using the existing session info
        try {
            // log in and initialize keystore
            await novelApi.populateKeyStore(extensionSettings['accessToken'], extensionSettings['encryptionKey']);
        } catch (ex) {
            toastr.error('An error occurred while accessing NovelAI. Please log in again.')
            
            // Something happened. (Usually either the access token has expired, or the encryption key is invalid)
            log('An error occurred while populating keystore. Clearing keys', ex);
            // an error occurred. Clear keys and force login
            keys['accessToken'] = '';
            keys['encryptionKey'] = '';
            keys['keystore'] = {};

            // Clear NAI session info in settings since they are invalid. 
            extensionSettings['accessToken'] = '';
            extensionSettings['encryptionKey'] = '';
            saveSettingsDebounced();
        }
    }

    // Retrieve main content div from jQuery
    var $content = $("#nai-import-index .content-main");

    // Do we need to log in?
    if (!keys['accessToken'] || !keys['encryptionKey']) {
        showLogin($content);
    }

    return (keys['accessToken'] && keys['encryptionKey'])
}

function showLoading($content) {
    $content.empty();
    $content.append('<div style="height:100%"><div style="margin-top:auto; margin-bottom:auto;">Loading, please wait...</div></div>');
}

// Borrowed from https://stackoverflow.com/questions/10617710/how-to-convert-jpg-image-to-png-using-javascript/76406044#76406044
function convertImgToPng(imgUrl, callback) {
    var img = new Image();

    img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;

        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Convert the image to PNG format
        var pngDataUrl = canvas.toDataURL('image/png');

        // Pass the converted PNG URL to the callback function
        callback(pngDataUrl);
    };

    img.src = imgUrl;
}

// Add the login form to the content area specified
function showLogin($content) {
    var keys = novelApi['keys']
    var extensionSettings = extension_settings[extensionName];

    // Clear the content area of the dialog box
    $content.empty();
    // Add login form to dialog
    $content.append(loginHtml);


    // Add login button handler
    $('#nai-import-login button[name=nai-login]').off().on('click', async function(){
        try {
            // Login using username/password info to generate an access and encryption key, and populate access token and keystore
            await novelApi.login(
                $('#nai-import-login input[name=nai-username]').val(), 
                $('#nai-import-login input[name=nai-password]').val()
            );

            // clear hashed access key so that it isn't sitting around.
            keys['accessKey'] = '';

            // Save access token and encryption key into settings so that we can use this session for future page refreshes.
            extensionSettings['accessToken'] = keys['accessToken'];
            extensionSettings['encryptionKey'] = novelApi.encodeBase64(keys['encryptionKey']);
            saveSettingsDebounced();
            onImportCharacterButton();
        } catch (ex){
            // Todo: add login error handling
            console.log(ex);
            if (ex['status'] == 401)
            {
                toastr.error('Please check your username and/or password and try again.', 'Unable to log in to NovelAI.')
            }
            else if (ex['responseJSON'] && ex.responseJSON['statusCode'] && ex.responseJSON['message']) 
            {
                toastr.error(ex.responseJSON['message']);
            }
            else 
            {
                toastr.error('An unknown error has occurred. If your site is not running over HTTPS, you will need to install and enable the NovelAi Passthrough plugin.');
            }

        }
    });

}

/**
 * Imports a character from a file. --Borrowed from scripts.js since it isn't exported
 * @param {File} file File to import
 * @param {boolean?} preserveFileName Whether to preserve original file name
 * @returns {Promise<void>}
 */
async function importCharacter(file, preserveFileName = false) {
    if (is_group_generating || is_send_press) {
        toastr.error('Cannot import characters while generating. Stop the request and try again.', 'Import aborted');
        throw new Error('Cannot import character while generating');
    }

    const ext = file.name.match(/\.(\w+)$/);
    if (!ext || !(['json', 'png', 'yaml', 'yml'].includes(ext[1].toLowerCase()))) {
        return;
    }

    const format = ext[1].toLowerCase();
    $('#character_import_file_type').val(format);
    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('file_type', format);
    formData.append('preserve_file_name', String(preserveFileName));

    const data = await jQuery.ajax({
        type: 'POST',
        url: '/api/characters/import',
        data: formData,
        async: true,
        cache: false,
        contentType: false,
        processData: false,
    });

    if (data.error) {
        toastr.error('The file is likely invalid or corrupted.', 'Could not import character');
        return;
    }

    if (data.file_name !== undefined) {
        $('#character_search_bar').val('').trigger('input');

        let oldSelectedChar = null;
        if (this_chid !== undefined) {
            oldSelectedChar = characters[this_chid].avatar;
        }

        await getCharacters();
        select_rm_info('char_import', data.file_name, oldSelectedChar);
        if (power_user.import_card_tags) {
            let currentContext = getContext();
            let avatarFileName = `${data.file_name}.png`;
            let importedCharacter = currentContext.characters.find(character => character.avatar === avatarFileName);
            await importTags(importedCharacter);
        }
    }
}

async function showImgFileChooser(evt) {

    $('#nai-import-index').closest('#dialogue_popup').find('#dialogue_popup_ok').trigger('click');
    // Create and trigger popup dialog box
    var popup = callPopup(chooseImageHtml, 'text', '', {okButton: 'Import Character card'});

    var imageData = await popup.then(async function() {
        var $fileInput = $('#nai-import-chooseimage input[name=nai-import-avatar-image]');
        log($fileInput);
        var files = ($fileInput[0] || { files: [] }).files;
        if (files.length < 1) {
            return '';
        }

        var file = files[0];
        let reader = new FileReader();
        var imagePromise = new Promise(resolve => {
            reader.onload = async (e) => {
                var b64Img = e.target.result;
                resolve(b64Img);
            };
        });
        reader.readAsDataURL(file);
        return await imagePromise;
    });
    return await imageData;
}

function downloadFile(filename, text) {
    var element = document.createElement('a');
    element.setAttribute('href', text);
    element.setAttribute('download', filename);

    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

async function onImportNovelAi(evt) {
    var story = $(evt.delegateTarget).data('story');

    var data = await novelApi.getCharacterCardV1(story['id']);
    var imgData = await showImgFileChooser(evt);

    if (!imgData) {
        let fileName = story['id'] + '.json'
        let blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
        let file = new File([blob], fileName,{type:"application/json", lastModified:new Date().getTime()}, 'utf-8');
        importCharacter(file, false);
    } else {
        convertImgToPng(imgData, function (imgPng) {
            var newImg = MetaPNG.addMetadataFromBase64DataURI(imgPng, 'chara', btoa(JSON.stringify(data)));
            var arr = newImg.split(','),
            mime = arr[0].match(/:(.*?);/)[1],
            bdata = new Uint8Array(novelApi.decodeBase64(arr[arr.length - 1]));
            let fileName = story['id'] + '.png'
            let blob = new Blob([bdata], { type: mime })
            let file = new File([blob], fileName,{type:mime, lastModified:new Date().getTime()});
            importCharacter(file, false);
        });

    }
}

async function showStories($content) {
    showLoading($content);
    var stories = await novelApi.getUserStories();
    log(stories);
    // Clear the content area of the dialog box
    $content.empty();
    if (stories) {
        for(var k in stories) {
            var $elem = $('<div class="character-card" />');
            var $avatar = $('<div class="avatar" title="[Character]"></div>')
            var $img = $('<img src="/User%20Avatars/user-default.png" alt="" />');
            var $avatarButtons = $('<span class="avatar-buttons"></span>');
            var $info = $('<div></div>');
            var story = stories[k];
            var data = story['data'] || {};
            var title = data['title'] || "";
            var description = data['description'] || "";
            
            var $heading = $('<p class="wide100p character_name_block"><span class="flex1"><strong>' + title + '</strong></span></p>');
            var $button = $('<button class="menu_button" title="Import Character" data-i18n="Import Character"><i class="fa-fw fa-solid fa-cloud-arrow-down"></i></button>');
            $button.data('story', story);
            $button.off().on('click', onImportNovelAi);

            $heading.append($avatarButtons);
            $avatarButtons.append($button);
            $info.append($heading);
            $info.append('<p>' + description + '</p>');
            $avatar.attr('title', '[Character] ' + title);
            $img.attr('alt', title);
            $avatar.append($img);
            $elem.append($avatar);
            $avatar.after($info);
            $content.append($elem); 
            $content.append('<hr style="margin-bottom:1em;" />')
        }
    }
}

async function onImportCharacterButton(evt) {
    // Create and trigger popup dialog box
    var popup = callPopup(indexHtml, 'text', '', {wide: true, large: true, allowHorizontalScrolling: true, okButton: 'Close'});

    // Retrieve main content div from jQuery
    var $content = $("#nai-import-index .content-main");

    showLoading($content);
    
    if (await tryLogin()) {
        showStories($content);
    } else {
        showLogin($content);
    }

    popup.then(function(evt){
        //log('Popup has been closed');
    });

    // Add handlers for original import buttons in dialog box.
    $('#nai-import-index .orig_character_import_button').off().on('click', onOriginalCharacterImportButton);
    $('#nai-import-index .orig_external_import_button').off().on('click', onOriginalExternalImportButton);
}

/*
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
*/

// This function is called when the extension is loaded
jQuery(async () => {
    log('Waiting for libSodium to resolve')
    
    window.sodium = {
        onload: function(sodium) {
            log('libSodium Ready');
            // Load settings when starting things up (if you have any)
            loadSettings();
            const extensionSettings = extension_settings[extensionName];

            if (extensionSettings['passthroughEnabled']) {
                // Use novelai-passthrough extension if not running over SSL
                novelApi.setApiEndpoint(`/api/plugins/novelai-passthrough`);
                novelApi.setAuthHeader('_Authorization');
            }

            // Append settingsHtml to extensions_settings
            // extension_settings and extensions_settings2 are the left and right columns of the settings menu
            // Left should be extensions that deal with system functions and right should be visual/UI related 
            $("#extensions_settings").append(settingsHtml);

            // Listen for events in settings
            $("#nai-import-enabled").on("input", onSettingsEnablePlugin);
            $("#nai-import-passthrough-enabled").on("input", onSettingsEnablePassthrough);


        }
    };
    
    // libSodium is strange. Load it Async via jQuery and allow it to resolve and initialize the rest of the module.
    await $.getScript(`${extensionFolderPath}/lib/libsodium-sumo/dist/modules-sumo/libsodium-sumo.min.js`);
    await $.getScript(`${extensionFolderPath}/lib/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.min.js`);
});
