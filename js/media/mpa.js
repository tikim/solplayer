
function SBPMpa() {


}

SBPMpa.table = {

    sampleRate: [

        11025,  12000,  8000,   0,
        0,      0,      0,      0,
        22050,  24000,  16000,  0,
        44100,  48000,  32000,  0
    ],

    samples: [

        0,      576,    1152,   384,
        0,      0,      0,      0,
        0,      576,    1152,   384,
        0,      1152,   1152,   384
    ],

    bitRate: [

        // reserved
        0,  0,  0,  0,  0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,
        // mpeg2.5 layer 3
        0,  8,  16, 24, 32,     40,     48,     56,     64,     80,     96,     112,    128,    144,    160,    0,
        // mpeg2.5 layer 2
        0,  8,  16, 24, 32,     40,     48,     56,     64,     80,     96,     112,    128,    144,    160,    0,
        // mpeg2.5 layer 1
        0,  32, 48, 56, 64,     80,     96,     112,    128,    144,    160,    176,    192,    224,    256,    0,
        // reserved
        0,  0,  0,  0,  0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,
        // reserved
        0,  0,  0,  0,  0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,
        // reserved
        0,  0,  0,  0,  0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,
        // reserved
        0,  0,  0,  0,  0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,
        // reserved
        0,  0,  0,  0,  0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,
        // mpeg2 layer 3
        0,  8,  16, 24, 32,     40,     48,     56,     64,     80,     96,     112,    128,    144,    160,    0,
        // mpeg2 layer 2
        0,  8,  16, 24, 32,     40,     48,     56,     64,     80,     96,     112,    128,    144,    160,    0,
        // mpeg2 layer 1
        0,  32, 48, 56, 64,     80,     96,     112,    128,    144,    160,    176,    192,    224,    256,    0,
        // reserved
        0,  0,  0,  0,  0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,      0,
        // mpeg1 layer 3
        0,  32, 40, 48, 56,     64,     80,     96,     112,    128,    160,    192,    224,    256,    320,    0,
        // mpeg1 layer 2
        0,  32, 48, 56, 64,     80,     96,     112,    128,    160,    192,    224,    256,    320,    384,    0,
        // mpeg1 layer 1
        0,  32, 64, 96, 128,    160,    192,    224,    256,    288,    320,    352,    384,    416,    448,    0
    ]
};

SBPMpa.parseFrame = function(data, offset, length, info) {

    if(data[offset] !== 0xff || (data[offset+1] & 0xe0) !== 0xe0) return length;

    var ch, ver, layer;
    var bitrate, samples;

    ch = (data[offset+3] >> 6) & 0x03;
    ver = ((data[offset+1] >> 3) & 0x03);
    layer = ((data[offset+1] >> 1) & 0x03);

    if(info.objType === undefined) {

        if(ch === 3) info.channels = 1;
        else info.channels = 2;

        info.sampleBits = 16;
        info.objType = 34;
        info.sampleRate = SBPMpa.table.sampleRate[(ver * 4) + ((data[offset+2] >> 2) & 0x03)];
        info.tick = SBPMpa.table.samples[(ver * 4) + layer] * info.tscale / info.sampleRate;
    }

    samples = SBPMpa.table.samples[(ver * 4) + layer];
    bitrate = SBPMpa.table.bitRate[((ver * 4 + layer) * 16) + ((data[offset+2] >> 4) & 0x0f)];

    return ((samples / 8) * bitrate * 1000 / info.sampleRate) + ((data[offset+2] >> 1) & 0x01);
};


