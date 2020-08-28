
var SBPTrack = {

    audio : { id: 0x1, desc: "audio", },
    video : { id: 0x2, desc: "video", },
    text : { id: 0x04, desc: "text", },
    meta : { id: 0x08, desc: "meta", },
};

var SBPCodec = {

    mpa : { id:3, desc: "mpa", track: SBPTrack.audio, },
    aac : { id:15, desc: "aac", track: SBPTrack.audio, },
    mp4v : { id:16, desc: "mp4v", track: SBPTrack.video, },
    id3 : { id:21, desc: "id3", track:SBPTrack.meta, },
    avc : { id:27, desc: "avc", track: SBPTrack.video, },
    hevc : { id:36, desc: "hevc", track: SBPTrack.video, },
};

var SBPFrameType = {

    key : "key",
    delta : "delta",
    eof : "_eof",
    split : "split",
};

// 오디오 관련 //////////
var SBPAudio = {

    sampleRate: [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350, 0, 0, 0],
    sampleRateIndex: function (sr) {

        var i;

        for(i = 0; i < SBPAudio.sampleRate.length; i++) {

            if(SBPAudio.sampleRate[i] === sr) return i;
        }

        return 0;
    },
};

// 딜레이 프리셋
var SBPDelay = {

    normal : "normal",
    minimum : "minimum",
    extreme : "extreme",
    custom : "custom",
};

// 비디오 관련 //////////
