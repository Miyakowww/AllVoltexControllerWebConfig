(function(window, document) {
"use strict";

// could be monim, could be pretending
var vids = [0x16D0, 0x1CCF];
var pids = [0x0A6E, 0x1014];

var device;

var SWITCH_COUNT = 8;
var BRIGHTNESS_MAX = 127;
var CONFIG_OUT_EPADDR = 1;
var CONFIG_IN_EPADDR  = 2;
var packetSize = 64;

var commands = {
    GETCONFIG     : 1,
    SETCONFIG     : 2,
    VERSION       : 3,
    DEFAULTCONFIG : 4,
    RESET :     42
};

var configDisplay = [
    {id: 'controlMode', name: lang[0],
        options : [{name: lang[1], val: 0},
                   {name: lang[2], val: 1},
                   {name: lang[3], val: 2}]},
    {id: 'switches', name: lang[4], labels: ['START','BT-A','BT-B','BT-C','BT-D','FX-L','FX-R']},
    {id: 'macroClick', name: lang[5]},
    {id: 'macroHold', name: lang[6]},
    {id: 'macroPin', name: lang[7]},
    {id: 'lightsOn', name: lang[8], children: [
        {id: 'ledBrightness', name: lang[9], min: 1, max: 31},
        {id: 'hidLights', name: lang[10]},
        {id: 'keyLights', name: lang[11], children: [        
            {id: 'btColour', name: lang[12]},
            {id: 'fxColour', name: lang[13]},
            {id: 'startColour', name: lang[14]},
        ]},
        {id: 'tool2key', name: lang[15]},
        {id: 'knobLights', name: lang[16]},
            {id: 'knobL', name: lang[17]},
            {id: 'knobR', name: lang[18]},
        {id: 'lightPattern', name: lang[19],
            options : [{name: lang[20],     val: 1},
                       {name: lang[21],    val: 2},
                       {name: lang[22],  val: 4},
                       {name: lang[23], val: 3}]},
        {id: 'breatheColour', name: lang[24]},
    ]},
];

// to match with firmware
var settingOrder = [
    'version',
    'switches',
    'controlMode',
    'btColour',
    'fxColour',
    'breatheColour',
    'knobL',
    'knobR',
    'lightsOn',
    'hidLights',
    'keyLights',
    'tool2key',
    'knobLights',
    'lightPattern',
    'macroClick',
    'macroHold',
    'macroLen',
    'macroPin',
    'ledBrightness',
    'startColour',
];

var visibleLog = function(html) {
    console.log(html);
    var log = document.getElementById('logview');
    log.innerHTML += html + '<br/>';
    log.scrollTop = log.scrollHeight;
}

class BinaryBuffer {
    constructor(view) {
        this.view = view;
        this.offset = 0;
    }
    
    read(size, forceArray = false) {
        let ret;
        if(size == 1 && !forceArray) {
            ret = this.view.getUint8(this.offset);
        } else {
            ret = [];
            for(var i = 0; i < size; i++) {
                ret[i] = this.view.getUint8(this.offset+i);
            }
        }
        this.offset += size;
        return ret;
    }
    
    write(data) {
        if(Array.isArray(data)) {
            for(let i = 0; i < data.length; i++) {
                this.view[this.offset+i] = data[i];
            }
            this.offset += data.length;
        } else {
            this.view[this.offset++] = data;
        }
    }
    
    rewind() {
        this.offset = 0;
    }
}

class ConfigValues {
    constructor() {
        this.version       = new SettingPlaceholder(2);
        this.switches      = new SettingKeys(SWITCH_COUNT, true);
        this.controlMode   = new SettingRadio();
        this.btColour      = new SettingRGB(BRIGHTNESS_MAX);
        this.fxColour      = new SettingRGB(BRIGHTNESS_MAX);
        this.startColour   = new SettingRGB(BRIGHTNESS_MAX);
        this.breatheColour = new SettingRGB(BRIGHTNESS_MAX);
        this.knobL         = new SettingRGB(BRIGHTNESS_MAX);
        this.knobR         = new SettingRGB(BRIGHTNESS_MAX);
        this.lightsOn      = new SettingBool();
        this.ledBrightness = new SettingSlider();
        this.hidLights     = new SettingBool();
        this.keyLights     = new SettingBool();
        this.tool2key      = new SettingBool();
        this.knobLights    = new SettingBool();
        this.lightPattern  = new SettingRadio();
        this.macroClick    = new SettingMacro();
        this.macroHold     = new SettingMacro();
        this.macroLen      = new SettingPlaceholder(1);
        this.macroPin      = new SettingKeys(4);
    }
    
    read(view, writeCallback) {
        var buffer = new BinaryBuffer(view);
        // skip the returned command byte
        buffer.read(1);
        
        settingOrder.forEach(setting => {
            this[setting].read(buffer);
            this[setting].setCallback(writeCallback);
        });
    }

    write(view) {
        var buffer = new BinaryBuffer(view);
        buffer.write(commands.SETCONFIG);
        
        settingOrder.forEach(setting => {
            this[setting].write(buffer);
        });
    }

    getArray(view, offset, size) {
        var ret = [];
        for(var i = 0; i < size; i++) {
            ret[i] = view.getUint8(offset+i);
        }
        return ret;
    };

    getColour(view, offset) {
        return 'rgb(' + this.getArray(view, offset, 3).join() + ')';
    };

    getKeys(view, offset, size) {
        var keys = [];
        for(let i = 0; i < size; i++) {
            keys[i] = this.getKey(view, offset++);
        }
        return keys;
    }

    getKey(view, offset) {
        var key = view.getUint8(offset);
        return scancodes.find(code => {return code.value == key});
    }
}

const SkipOption = [
//     'btColour',
//     'fxColour',
//     'startColour',
     'tool2key',
     'knobLights'
]

class Config {
    constructor() {
        visibleLog(lang[25]);
        this.optionsDiv = document.getElementById('configOptions');
        this.config = new ConfigValues();
        // DEBUG
        //this.enableUI();
    }
    
    connectNew() {
        return window.UsbWrapper.connect(vids, pids)
        .then(selectedDevice => {
            if(!selectedDevice) {
                return Promise.reject(lang[26]);
            }
            this.connect(selectedDevice);
        })
    }
    
    connect(selectedDevice) {
        console.log(selectedDevice);
        device = selectedDevice;
        visibleLog(lang[27]);
        return device.open()
        .then(() => {
            console.log(lang[28]);
            return device.selectConfiguration(1)
        })
        .then(() => {
            if(device.deviceVersionSubminor == 2) { // bootloader
                if(this.board) {
                    return this.loadFirmware();
                } else {
                    document.getElementById('boardSelector').classList.remove('hidden');
                }
            } else if(device.deviceVersionSubminor == 3) { // main program
                return this.loadConfig();
            } else {
                return Promise.reject(lang[29]);
            }
        })
        .catch(error => {
            //alert(error);
            visibleLog(error);
            if(device && device.opened)
                device.close();
        });
    }
    
    selectBoard(board) {
        this.board = board;
        document.getElementById('boardSelector').classList.add('hidden');
        
        this.loadFirmware()
        .catch(error => {
            //alert(error);
            visibleLog(error);
            if(device && device.opened)
                device.close();
        });
    }
    
    loadFirmware() {
        visibleLog(lang[30]);
        return getLatest(this.board)
        .then(downloadLatest)
        .then(firmware => {
            visibleLog(lang[31]);
            return programLatest(device, firmware);
        })
        .then(() => {
            visibleLog(lang[32]);
        })
    }
    
    loadConfig() {
        console.log(lang[33]);
        return device.claimInterface(0)
        .then(() => {
            visibleLog(lang[34]);
            return this.readVersion();
        })
        .then(version => {
            this.version = version.fw;
            this.board = version.board;
            visibleLog(lang[35] + this.version/10.0);
            return getLatest(this.board);
        })
        .then(latestInfo => {
            if(latestInfo.version > this.version) {
                alert(lang[36]);
                visibleLog(lang[37]);
                this.rebootToBootloader();
                return Promise.reject(lang[38]);
            }
        })    
        .then(() => {
            this.enableUI();
            return this.readConfig();
        });
    }
    
    readVersion() {
        if(!device || !device.opened)
            return Promise.reject(lang[39]);
        
        var data = new Uint8Array(packetSize);
        data[0] = commands.VERSION;
        return device.transferOut(CONFIG_OUT_EPADDR, data)
        .then(() => device.transferIn(CONFIG_IN_EPADDR, packetSize))
        .then(result => {
            console.log(result);
            console.log("Got version response of len", result.data.buffer.byteLength);
            // version int exists at offset 1
            let fwVersion = result.data.getUint16(1, true);
            let boardRevision = result.data.getUint16(3, true);
            if(boardRevision == 0xDEAD) {
                boardRevision = 4;
            }
            console.log('ver:board', fwVersion, boardRevision);
            return {fw: fwVersion, board: boardRevision};
        })
    }
    
    readConfig() {
        if(!device || !device.opened)
            return Promise.reject(lang[39]);
        var data = new Uint8Array(packetSize);
        data[0] = commands.GETCONFIG;
        return device.transferOut(CONFIG_OUT_EPADDR, data)
        .then(() => device.transferIn(CONFIG_IN_EPADDR, packetSize))
        .then(result => {
            console.log("Got config response of len", result.data.buffer.byteLength);
            this.config.read(result.data, this.writeConfig.bind(this));
        });
    }
    
    writeConfig() {
        if(!device || !device.opened)
            return Promise.reject(lang[39]);
        
        console.log("Writing config");
        var data = new Uint8Array(packetSize);
        this.config.write(data);
        return device.transferOut(CONFIG_OUT_EPADDR, data);
    }
    
    loadDefaults() {
        if(!device || !device.opened)
            return Promise.reject(lang[39]);
        if(!confirm(lang[40]))
            return Promise.resolve('Cancelled');
        var data = new Uint8Array(packetSize);
        data[0] = commands.DEFAULTCONFIG;
        return device.transferOut(CONFIG_OUT_EPADDR, data)
        .then(this.readConfig.bind(this));
    }
    
    close() {
        if(!device || !device.opened)
            return Promise.reject(lang[39]);
        visibleLog(lang[41]);
        return device.close();
    }
    
    rebootToBootloader() {
        if(!device || !device.opened)
            return Promise.reject(lang[39]);
        var data = new Uint8Array(packetSize);
        data[0] = commands.RESET;
        return device.transferOut(CONFIG_OUT_EPADDR, data);
    };
    
    populateSettings(parent, settings) {
        settings.forEach(setting => {
            var settingObj = this.config[setting.id];
            var container = settingObj.createUI(setting);
            settingObj.setCallback(this.writeConfig.bind(this));

            var skip = false;
            SkipOptions.forEach(option => {
                if(setting.id == option.id) {
                    skip = true;
                }
            });

            if(setting.children) {
                var newParent = document.createElement('div');
                newParent.className = 'nestedSetting';
                
                this.populateSettings(newParent, setting.children);
                if(!skip) {
                    container.appendChild(newParent);
                }
            }
            if(!skip) {
                parent.appendChild(container);
            }
        });
    }

    daisuke() {
        if(!confirm('一键Daisuke会改变某些设置，如想恢复必须手动进行更改。确定继续？'))
            return Promise.resolve('Cancelled');
            
        document.getElementById("lightPattern-0").click();
        this.config['btColour'].picker.fromRGB(255,255,255);
        this.config['fxColour'].picker.fromRGB(255,255,255);
        this.config['startColour'].picker.fromRGB(255,255,255);
        this.config['knobL'].picker.fromRGB(255,255,255);
        this.config['knobR'].picker.fromRGB(255,255,255);
        document.getElementById("check-lightsOn").checked = true;
        document.getElementById("check-hidLights").checked = false;
        document.getElementById("check-keyLights").checked = true;
        document.getElementById("slider-ledBrightness").value = 31;
        document.getElementById("slider-ledBrightness").oninput.call();
    }
    
    enableUI() {
        //document.getElementById('configBox').classList.remove('hidden', 'disabled');
        document.getElementById('connect').classList.add('hidden');
        
        var defaults = document.createElement('input');
        defaults.type = 'button';
        defaults.value = lang[42];
        defaults.onclick = this.loadDefaults.bind(this);
        this.optionsDiv.appendChild(defaults);

        if(navigator.language.startsWith("zh")) {
            var defaults = document.createElement('input');
            defaults.type = 'button';
            defaults.value = '一键 Daisuke';
            defaults.onclick = this.daisuke.bind(this);
            this.optionsDiv.appendChild(defaults);
        }
        
        this.populateSettings(this.optionsDiv, configDisplay);
    }
    
    disableUI() {
        visibleLog(lang[43]);
        document.getElementById('connect').classList.remove('hidden');
        document.getElementById('boardSelector').classList.add('hidden');
        this.optionsDiv.innerHTML = '';
    }
};

window.Config = Config;
window.visibleLog = visibleLog;

})(window, document);