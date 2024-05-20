import { Unpackr, addExtension } from "../msgpackr/index.min.js";

export function NovelAiApi(accessToken = null, encryptionKey = null) {
    const compressionHeader = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1].toString();
    var keys = {
        accessToken: accessToken,
        encryptionKey: encryptionKey,
        keystore: []
    };

    var lib = {
        keys: keys,
        login: login,
        populateKeyStore: populateKeyStore,
        encodeBase64: encodeBase64,
        decodeBase64: decodeBase64,
        decodeData: decodeData,
        getUserStories: getUserStories,
        getUserStory: getUserStory,
        getUserStoryContent: getUserStoryContent,
        getCharacterCardV1: getCharacterCardV1,
        getCharacterCardV2: getCharacterCardV2
    };

    // Custom MsgPackr extensions with read passthrough for handling Document decoding
    function extReadPassthrough(data) {
        return data;
    };
    addExtension({ type: 20, read: extReadPassthrough });
    addExtension({ type: 30, read: extReadPassthrough });
    addExtension({ type: 31, read: extReadPassthrough });
    addExtension({ type: 40, read: extReadPassthrough });
    addExtension({ type: 41, read: extReadPassthrough });

    function hashArgon(email, password, size, domain) {
        preSalt = (password || '').substr(0, 6) + email + domain;
        var salt = sodium.crypto_generichash(16, preSalt)
        return sodium.crypto_pwhash(size, password, salt, 2, 2000000, 2);
    }

    function getEncryptionKey(secret, user) {
        if (secret instanceof Uint8Array) {
            return secret;
        }
        var encryption_key = hashArgon(user, secret, 128, 'novelai_data_encryption_key');
        var encryption_string = btoa(String.fromCharCode.apply(null, encryption_key));
        encryption_string = encryption_string.replaceAll("/", "_").replaceAll("+", "-").replaceAll("=", "");
        return sodium.crypto_generichash(32, encryption_string)
    }

    function getAccessKey(secret, user) {
        var access_key = [];
        if (secret instanceof Uint8Array) {
            return user;
        } else if (typeof (user) === 'string' && typeof (secret) === 'string') {
            access_key = hashArgon(user, secret, 64, 'novelai_data_access_key');
        }
        var access_string = btoa(String.fromCharCode.apply(null, access_key)).substr(0, 64)
        return access_string.replaceAll("/", "_").replaceAll("+", "-");
    }

    async function buildEncryptionKeys(secret, user) {
        return {
            encryptionKey: getEncryptionKey(secret, user),
            accessKey: getAccessKey(secret, user),
            accessToken: null,
            keystore: []
        }
    }

    async function getAccessToken(accessKey) {
        var accessToken = null;
        await $.ajax({
            type: "POST",
            url: 'https://api.novelai.net/user/login',
            data: JSON.stringify({
                key: accessKey
            }),
            contentType: 'application/json'
        }).done(function (response) {
            accessToken = response['accessToken'];
        });
        return accessToken;
    }

    async function populateKeyStore(accessToken, encryptionKey) {
        if (typeof (encryptionKey) == 'string') {
            encryptionKey = new Uint8Array(decodeBase64(encryptionKey));
        }

        await $.ajax({
            type: "GET",
            url: 'https://api.novelai.net/user/keystore',
            contentType: 'application/json',
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
            }
        }).done(function (response) {
            try {
                if (!response['keystore'])
                    throw Exception();

                var data = JSON.parse(atob(response['keystore']));
                if (!data['nonce'] || !data['sdata'])
                    throw Exception();

                var bytes = sodium.crypto_secretbox_open_easy(new Uint8Array(data['sdata']), new Uint8Array(data['nonce']), encryptionKey);
                var str = new TextDecoder().decode(bytes);
                lib.keys.keystore = JSON.parse(str)['keys'];
                lib.keys.encryptionKey = encryptionKey;
                lib.keys.accessToken = accessToken;
            } catch {
                throw ("Unable to decode keystore");
            }
        });

        return lib.keys;
    }


    // Login to NovelAi API with either an email/password, or AccessKey/EncryptionKey
    // Pass in email address for the user and password for the secret to generate and access and encryption key and login,
    // or
    // Pass in the access key string for the user and a Uint8Array encryption key for the secret to log in directly
    async function login(user, secret) {
        var keys = await buildEncryptionKeys(secret, user);
        this.keys.accessKey = keys.accessKey;
        this.keys.encryptionKey = keys.encryptionKey;
        this.keys.accessToken = await getAccessToken(this.keys.accessKey);
        await populateKeyStore(this.keys.accessToken, this.keys.encryptionKey);
        return lib.keys;
    }

    function encodeBase64(dataIn) {
        return btoa(String.fromCharCode.apply(null, dataIn))
    }

    function decodeBase64(dataIn) {
        return atob(dataIn).split('').map(function (c) { return c.charCodeAt(0); });
    }

    function decodeData(dataIn, meta) {
        var bytes;
        var str = atob(dataIn);
        var data = Uint8Array.from(str, (m) => m.codePointAt(0));
        sk = meta ? lib.keys.keystore[meta] : null;

        // Is data compressed?
        if (data.length > 16) {
            if (compressionHeader == data.slice(0, 16).toString()) {
                // Data is compressed, use deflate to decompress
                bytes = data.slice(16);

                if (sk) {
                    var nonce = bytes.slice(0, 24);
                    bytes = bytes.slice(24);
                    bytes = sodium.crypto_secretbox_open_easy(bytes, nonce, new Uint8Array(sk));
                    //return new TextDecoder().decode(bytes);
                }
                return pako.inflateRaw(bytes, { to: 'string', raw: true });
            }
        }

        if (sk) {
            bytes = data.slice(24);
            var nonce = data.slice(0, 24);
            var bytes = sodium.crypto_secretbox_open_easy(bytes, nonce, new Uint8Array(sk));
            return new TextDecoder().decode(bytes);
        }

        return decodeBase64(dataIn);
    }

    function decodeDocument(dataIn) {
        var str = atob(dataIn);
        var data = Uint8Array.from(str, (m) => m.codePointAt(0));
        var unpacker = new msgpackr.Unpackr();
        return unpacker.unpack(data, { bundleStrings: true, moreTypes: true });
    }

    async function getUserStories() {
        var response = {};
        await $.ajax({
            type: "GET",
            url: 'https://api.novelai.net/user/objects/stories',
            contentType: 'application/json',
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", "Bearer " + lib.keys.accessToken);
            }
        }).done(function (data) {
            for (var i = 0; i < data['objects'].length; i++) {
                var obj = data['objects'][i];
                obj['encodedData'] = obj['data'];
                obj['data'] = JSON.parse(decodeData(obj['encodedData'], obj['meta']));
                response[obj['id']] = obj
            }
        });
        return response;
    }

    async function getUserStory(storyId) {
        var response = {};
        await $.ajax({
            type: "GET",
            url: 'https://api.novelai.net/user/objects/stories/' + storyId,
            contentType: 'application/json',
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", "Bearer " + lib.keys.accessToken);
            }
        }).done(function (data) {
            var obj = data;
            obj['encodedData'] = obj['data'];
            obj['data'] = JSON.parse(decodeData(obj['encodedData'], obj['meta']));
            response = obj
        });
        return response;
    }

    async function getUserStoryContent(storyContentId) {
        var response = {};
        await $.ajax({
            type: "GET",
            url: 'https://api.novelai.net/user/objects/storycontent/' + storyContentId,
            contentType: 'application/json',
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", "Bearer " + lib.keys.accessToken);
            }
        }).done(function (data) {
            var obj = data;
            obj['encodedData'] = obj['data'];
            var objData = JSON.parse(decodeData(obj['data'], obj['meta']));
            obj['data'] = objData;
            objData['encodedDocument'] = objData['document'];
            objData['document'] = decodeDocument(objData['encodedDocument']);
            response = obj
        });
        return response;
    }

    async function getCharacterCardV1(storyId) {
        var story = await getUserStory(storyId);
        var storyData = await getUserStoryContent(story['data']['remoteStoryId']);

        var document = storyData['data']['document'];
        var context = storyData['data']['context'];
        var order = document['order'];
        var sections = document['sections'];
        var memory = (context || [{}])[0]['text'];
        var authorsNote = (context || [{}, {}])[1]['text'];
        var s = '';
        if (document && order && order.length > 0 && sections) {
            for (var i = 0; i < order.length; i++) {
                var node = document.sections.get(order[i]);
                if (node && node['text']) {
                    s += node.text += '\n';
                }
            }
        }
        return {
            name: story['data']['title'],
            description: memory,
            personality: '',
            scenario: authorsNote,
            first_mes: s,
            mes_example: ''
        }
    }

    async function getCharacterCardV2(storyId) {

    }



    return lib;
}
