
function SBPSource(video, config, logger) {

    this._ms = null;
    this.video = video;
    this.config = config;
    this.logger = logger;
    this.tracks = [];
    this.mainTrack = null;
    this.ready = false;
    this.cbd = false;
    this.mon = null;
    this.paused = false;
    this.eos = 0;
    this._newPos = -1;

    // Seeking시 버퍼 구간 갯수
    this._skbc = 0;

    this._status = {

        start: {sys: 0, media: 0,},
        elapse: {sys: 0, media: 0,},
        mse: {
            buffered: {

                audio: [],
                video: [],
            },

            position: 0,
            live: true,
        },
        input: {

            pos: 0,
        },

    };

    Object.defineProperty(this, 'newPos', {

        set: function(pos) {

            this._newPos = pos;
        },
    });

    /*
         비디오 Seek가 발생될 때 호출
      */
    this._onVidSeeking = function() {

        if(this.isLive()) return;

        if(this.video.currentTime === this._newPos) {

            this._newPos = -1;
            return;
        }

        var i, ipos;

        for(i = 0; i < this.tracks.length; i++) {

            if(this._isAvTrack(this.tracks[i])) {

                // 1. 현재 작업이 진행 중인 SourceBuffer 작업은 모두 중단 요청
                if(this.tracks[i].msesb) {

                    try {
                        this.tracks[i].msesb.abort();
                    } catch(e) {}
                }

                // 2. 현재 먹싱 중인 데이터 모두 중단 (* 오류 발생 시에 try{} 구문으로 우회)
                this.tracks[i].mxfrms = null;

                // 3. EOF 상태는 해제해 준다.
                this.tracks[i]._eof = false;
                this.tracks[i].discon = true;
            }
        }

        // 4. 비디오 위치와 동기화할 텍스트 메타 데이터의 기준을 재 설정한다.
        for(i = 0; i < this.tracks.length; i++) {

            if(!this._isAvTrack(this.tracks[i]) && this.tracks[i].queue.length > 0) {

                for(var j = 0; j < this.tracks[i].queue.length; j++) {

                    ipos = ((this.tracks[i].queue[j].pts - this.tracks[i].stat.firstdts) / this.tracks[i].tscale);

                    if(this.video.currentTime <= ipos) {

                        this.tracks[i].searchBase = i;
                        break;
                    }
                }
            }
        }

        // 5. 추가로 스트림을 받아야할(혹은 대기할) 위치를 계산한다.
        this._changeAppendPosition(true);

        /*
            @remark
            이미 존재하는 세그먼트 큐는 다운로드가 된 상태이고,
            굳이 드롭(Drop)할 필요가 없으며, 동기화에 문제가 발생할 소지가 있으므로 그대로 둔다.
         */
    };

    /*
         비디오 Pause될 때 호출
      */
    this._onVidPaused = function() {

        this.paused = true;
    };

    /*
        비디오 재생 재게(시작)될 때 호출

     */
    this._onVidPlaying = function() {

        if (this.isLive() && this.config.sbLiveResume === "restart" && this.paused) {

            // 재시작을 요청한다.
            if (this.ev.restart) this.ev.restart.dispatch();
            return;
        }

        this._status.start.sys = (new Date()).getTime();
        this._status.start.media = this.video.currentTime;

        this.paused = false;
    };

    /*
        주어진 트랙이 현재 버퍼 제한 크기를 넘었는지 검사
     */
    this._isTrackOverflow = function(track) {

        if (track.msesb != null) {

            for (var k = 0; k < track.msesb.buffered.length; k++) {

                var bs, be;

                bs = track.msesb.buffered.start(k);
                be = track.msesb.buffered.end(k);

                if (bs <= this.video.currentTime && this.video.currentTime <= be) {

                    be += (track.queue.length * this.config.sbSegmentDuration);

                    if (this.video.currentTime + this.config.sbBufferRange.back < be) {

                        return true;
                    }
                }
            }
        }

        return false;
    };

    this.ve = {

        seeking: this._onVidSeeking.bind(this),
        paused: this._onVidPaused.bind(this),
        playing: this._onVidPlaying.bind(this),
    };

    this.ev = {resume: null, ready: null, seek: null, meta: null, text: null, restart: null,};

    this._mp4Box = {

        moof: [0x6d, 0x6f, 0x6f, 0x66],
        mfhd: [0x6d, 0x66, 0x68, 0x64],
        traf: [0x74, 0x72, 0x61, 0x66],
        tfhd: [0x74, 0x66, 0x68, 0x64],
        tfdt: [0x74, 0x66, 0x64, 0x74],
        trun: [0x74, 0x72, 0x75, 0x6e],
        mdat: [0x6d, 0x64, 0x61, 0x74],
        moov: [0x6d, 0x6f, 0x6f, 0x76],
        mvhd: [0x6d, 0x76, 0x68, 0x64],
        mvex: [0x6d, 0x76, 0x65, 0x78],
        trex: [0x74, 0x72, 0x65, 0x78],
        trak: [0x74, 0x72, 0x61, 0x6b],
        tkhd: [0x74, 0x6b, 0x68, 0x64],
        mdia: [0x6d, 0x64, 0x69, 0x61],
        mdhd: [0x6d, 0x64, 0x68, 0x64],
        minf: [0x6d, 0x69, 0x6e, 0x66],
        stsd: [0x73, 0x74, 0x73, 0x64],
        mp4a: [0x6d, 0x70, 0x34, 0x61],
        esds: [0x65, 0x73, 0x64, 0x73],
        avc1: [0x61, 0x76, 0x63, 0x31],
        avcC: [0x61, 0x76, 0x63, 0x43],
        stbl: [0x73, 0x74, 0x62, 0x6c],

        ftyp: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D, 0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6F, 0x6D, 0x6D, 0x70, 0x34, 0x32],
        tkhdMtrx: [0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x40, 0x00, 0x00, 0x00],

        mvhdMtrx: [0x00, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],

        videHdlr: [0x00, 0x00, 0x00, 0x2D, 0x68, 0x64, 0x6C, 0x72, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x76, 0x69, 0x64, 0x65, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x56, 0x69, 0x64, 0x65, 0x6F, 0x48, 0x61, 0x6E, 0x64, 0x6C, 0x65, 0x72, 0x00],

        vmhd: [0x00, 0x00, 0x00, 0x14, 0x76, 0x6D, 0x68, 0x64, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00],

        sounHdlr: [0x00, 0x00, 0x00, 0x2D, 0x68, 0x64, 0x6C, 0x72, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x73, 0x6F, 0x75, 0x6E, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x53, 0x6F, 0x75, 0x6E, 0x64, 0x48, 0x61, 0x6E, 0x64, 0x6C, 0x65, 0x72, 0x00],

        smhd: [0x00, 0x00, 0x00, 0x10, 0x73, 0x6D, 0x68, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],

        dinf: [0x00, 0x00, 0x00, 0x24, 0x64, 0x69, 0x6E, 0x66, 0x00, 0x00, 0x00, 0x1C, 0x64, 0x72, 0x65, 0x66,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x0C, 0x75, 0x72, 0x6C, 0x20,
            0x00, 0x00, 0x00, 0x01],

        stblSubChunk: [0x00, 0x00, 0x00, 0x10, 0x73, 0x74, 0x74, 0x73,     // stts
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x10, 0x73, 0x74, 0x73, 0x63,     // stsc
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x10, 0x73, 0x74, 0x63, 0x6F,     // stco
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x14, 0x73, 0x74, 0x73, 0x7A,     // stsz
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],

        stss: [0x00, 0x00, 0x00, 0x10, 0x73, 0x74, 0x73, 0x73,     // stss
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],

        esdsCfg: [0x06, 0x80, 0x80, 0x80, 0x01, 0x02],

    };

    // 상태 정보 프로퍼티
    Object.defineProperty(this, 'status', {

        get: function () {

            if (this._ms == null) return null;

            if (!this.paused) {

                var st = (new Date()).getTime();

                this._status.elapse.sys = ((st - this._status.start.sys) / 1000).toFixed(3);
                this._status.elapse.media = (this.video.currentTime - this._status.start.media).toFixed(3);
            }

            this._status.mse.live = this.isLive();
            this._status.mse.position = this.video.currentTime;
            this._status.mse.duration = this._ms.duration;

            for (var i = 0; i < this.tracks.length; i++) {

                if (this._isAvTrack(this.tracks[i]) && this.tracks[i].msesb != null) {

                    var buffered = [];

                    for (var j = 0; j < this.tracks[i].msesb.buffered.length; j++) {

                        buffered.push({
                            start: this.tracks[i].msesb.buffered.start(j),
                            end: this.tracks[i].msesb.buffered.end(j)
                        });
                    }

                    if (this.tracks[i].codec.track === SBPTrack.video) this._status.mse.buffered.video = buffered;
                    else if (this.tracks[i].codec.track === SBPTrack.audio) this._status.mse.buffered.audio = buffered;
                }
            }

            return this._status;
        },
    });

    // 재생 시간 프로퍼티
    Object.defineProperty(this, 'duration', {

        set: function (dur) {

            if (dur > 0) {

                this.logger.put(SBPLogLevel.stat, SBPLogSection.engine, "VOD Stream duration=" + dur);
                this._ms.duration = dur;
            }
        },
    });

    // MediaSource 프로퍼티
    Object.defineProperty(this, 'ms', {

        set: function (s) {

            this._ms = s;

            this.video.addEventListener('seeking', this.ve.seeking);
            this.video.addEventListener('pause', this.ve.paused);
            this.video.addEventListener('playing', this.ve.playing);
        },
    });

    // 입력 위치 프로퍼티
    Object.defineProperty(this, 'inputPosition', {

        set: function (pos) {

            this._status.input.pos = pos;
        },
    });

    this._updateTick = function(track, dts) {

        switch (track.codec.id) {

            case SBPCodec.mpa.id:
                break;

            case SBPCodec.aac.id:
                if (track.tick === 0) track.tick = (track.objType === 5 || track.objType === 29 ? 2048 : 1024) * track.tscale / track.sampleRate;
                break;

            case SBPCodec.avc.id:
                if (!track.discon) {

                    var tick = dts - track.stat.lastdts;

                    if (track.tick === 0) track.tick = tick;
                    else track.tick = Math.round((track.tick + tick) / 2);
                }
                break;
        }
    };

    this._isAvTrack = function(track) {

        return !(track.codec === undefined || track.codec.track === SBPTrack.meta || track.codec.track === SBPTrack.text);
    };

    // MSE 미디어 소스에 트랙을 추가합니다.
    this._init = function() {

        var res;

        for (var i = 0; i < this.tracks.length; i++) {

            var cdesc = null;

            if(this.tracks[i].codec !== undefined && this.tracks[i].init === false) {
                this.tracks[i].init = true;

                switch (this.tracks[i].codec.id) {

                    case SBPCodec.mpa.id:
                        this.logger.put(SBPLogLevel.stat, SBPLogSection.engine,
                            "mediaInfo: MPA " + this.tracks[i].sampleRate + "Hz " + this.tracks[i].channels + "ch");

                        cdesc = "mp4a.6B";
                        break;

                    case SBPCodec.aac.id:

                        this.logger.put(SBPLogLevel.stat, SBPLogSection.engine,
                            "mediaInfo: " + (this.tracks[i].objType === 5 || this.tracks[i].objType === 29 ? "HE-AAC" : "AAC-LC") + " " + this.tracks[i].sampleRate + "Hz " + this.tracks[i].channels + "ch");

                        cdesc = "mp4a.40." + this.tracks[i].objType;
                        break;

                    case SBPCodec.avc.id:

                        this.logger.put(SBPLogLevel.stat, SBPLogSection.engine,
                            "mediaInfo: AVC profile=" + this.tracks[i].profile + ", level=" + this.tracks[i].level + ", resolution=" + this.tracks[i].width + "x" + this.tracks[i].height);

                        cdesc = "avc1." + SBPUtil.toHexString(this.tracks[i].cfgblock[0], 1, 3, "");
                        break;

                    default:
                        if (!this._isAvTrack(this.tracks[i])) continue;
                        else return SBPError.implement;
                }
            }

            if (cdesc) {

                var sb;

                try {

                    if(this.tracks[i].codec === SBPCodec.mpa) {

                        var isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);

                        if(isChrome) sb = this._ms.addSourceBuffer("audio/mpeg");
                        else sb = this._ms.addSourceBuffer("audio/mp4");

                    } else {
                        sb = this._ms.addSourceBuffer((this.tracks[i].codec.track === SBPTrack.audio ? "audio" : "video") + "/mp4; codecs=" + cdesc);
                    }

                } catch (e) {

                    this.logger.put(SBPLogLevel.error, SBPLogSection.engine, "MSE " + this.tracks[i].codec.track.desc + " SourceBuffer Error: " + e.toString() + ", cdesc=" + cdesc);
                    sb = null;
                }

                if (sb) {

                    this.tracks[i].msesb = sb;

                    this.tracks[i].msesb.addEventListener('updateend', this.tracks[i].oue);
                    this.tracks[i].msesb.addEventListener('error', this.tracks[i].oe);

                    if (this.tracks[i].codec.track === SBPTrack.video) this.mainTrack = this.tracks[i];
                    else if (this.mainTrack == null) this.mainTrack = this.tracks[i];

                    if ((res = this._appendInit(this.tracks[i])) !== SBPError.success) return res;

                } else {

                    this.endOfStream();
                    return SBPError.sbCreate;
                }
            }
        }

        return SBPError.success;
    };

    this._esdsTag = function(track, offset, tag, remain) {

        track.mxbuf[offset++] = tag;
        track.mxbuf[offset++] = 0x80;
        track.mxbuf[offset++] = 0x80;
        track.mxbuf[offset++] = 0x80;
        track.mxbuf[offset++] = remain - 5;

        return offset;
    };

    // MSE 미디어 소스에 트랙 추가 후에 코덱 초기화 정보('moov' 박스) 먹싱하고 전달한다.
    this._appendInit = function(track) {

        var offset = 0,
            total = this._mp4Box.ftyp.length + this._mp4Box.mvhdMtrx.length + this._mp4Box.tkhdMtrx.length + 264 + this._mp4Box.dinf.length + this._mp4Box.stbl.length;

        if (track.codec.track === SBPTrack.video) total += this._mp4Box.videHdlr.length + this._mp4Box.vmhd.length;
        else if (track.codec.track === SBPTrack.audio) total += this._mp4Box.sounHdlr.length + this._mp4Box.smhd.length;
        else return SBPError.implement;

        switch (track.codec.id) {

            case SBPCodec.avc.id:
                total += 121 + track.cfgblock[0].length + track.cfgblock[1].length;
                break;

            case SBPCodec.aac.id:
                total += 95 + this._mp4Box.esdsCfg.length + track.cfgblock[0].length;
                break;

            case SBPCodec.mpa.id:
                total += 90 + this._mp4Box.esdsCfg.length;
                break;

            default:
                return SBPError.implement;
        }

        track.mxbuf.set(this._mp4Box.ftyp, offset);
        offset += this._mp4Box.ftyp.length;

        // moov
        offset = this._buildBox(track, this._mp4Box.moov, offset, total - offset);

        // mvhd
        offset = this._buildBox(track, this._mp4Box.mvhd, offset, 28 + this._mp4Box.mvhdMtrx.length + 4, true);

        offset = this._muxIntVal(track, offset, 0, 4); // create time
        offset = this._muxIntVal(track, offset, 0, 4); // modified time
        offset = this._muxIntVal(track, offset, 90000, 4); // time scale
        offset = this._muxIntVal(track, offset, 0, 4); // duration

        track.mxbuf.set(this._mp4Box.mvhdMtrx, offset);
        offset += this._mp4Box.mvhdMtrx.length;

        offset = this._muxIntVal(track, offset, 2, 4); // next track(1->2)

        // mvex
        offset = this._buildBox(track, this._mp4Box.mvex, offset, 40);
        offset = this._buildBox(track, this._mp4Box.trex, offset, 32, true);

        offset = this._muxIntVal(track, offset, 1, 4); // track id
        offset = this._muxIntVal(track, offset, 1, 4); // default sample description index
        offset = this._muxIntVal(track, offset, 0, 4); // default sample duration
        offset = this._muxIntVal(track, offset, 0, 4); // default sample size
        offset = this._muxIntVal(track, offset, track.codec.track === SBPTrack.video ? 0 : 0x10000, 4); // default sample flag

        // trak
        offset = this._buildBox(track, this._mp4Box.trak, offset, total - offset);

        // tkhd
        offset = this._buildBox(track, this._mp4Box.tkhd, offset, 48 + this._mp4Box.tkhdMtrx.length + 8, true, 0, 7);

        offset = this._muxIntVal(track, offset, 0, 4); // create time
        offset = this._muxIntVal(track, offset, 0, 4); // modified time
        offset = this._muxIntVal(track, offset, 1, 4); // track id
        offset = this._muxIntVal(track, offset, 0, 4); // reserved.
        offset = this._muxIntVal(track, offset, 0, 4); // duration

        offset = this._zeroPadding(track, offset, 12); // reserved 12 bytes(0)

        offset = this._muxIntVal(track, offset, track.codec.track === SBPTrack.audio ? 256 : 0, 2); // volume
        offset = this._zeroPadding(track, offset, 2); // reserved 2 bytes(0)

        track.mxbuf.set(this._mp4Box.tkhdMtrx, offset);
        offset += this._mp4Box.tkhdMtrx.length;

        offset = this._muxIntVal(track, offset, track.codec.track === SBPTrack.video ? track.width : 0, 4); // width
        offset = this._muxIntVal(track, offset, track.codec.track === SBPTrack.video ? track.height : 0, 4); // height

        // mdia
        offset = this._buildBox(track, this._mp4Box.mdia, offset, total - offset);

        // mdhd
        offset = this._buildBox(track, this._mp4Box.mdhd, offset, 32, true);

        offset = this._muxIntVal(track, offset, 0, 4); // create time
        offset = this._muxIntVal(track, offset, 0, 4); // modified time
        offset = this._muxIntVal(track, offset, track.tscale, 4); // time scale
        offset = this._muxIntVal(track, offset, 0, 4); // duration

        offset = this._muxIntVal(track, offset, 0x15c7, 2); // language code (일단 'eng'로 고정)
        offset = this._zeroPadding(track, offset, 2); // reserved 2 bytes(0)

        // hdlr
        if (track.codec.track === SBPTrack.video) {

            track.mxbuf.set(this._mp4Box.videHdlr, offset);
            offset += this._mp4Box.videHdlr.length;

        } else if (track.codec.track === SBPTrack.audio) {

            track.mxbuf.set(this._mp4Box.sounHdlr, offset);
            offset += this._mp4Box.sounHdlr.length;
        }

        // minf
        offset = this._buildBox(track, this._mp4Box.minf, offset, total - offset);

        // vmdh, smhd
        if (track.codec.track === SBPTrack.video) {

            track.mxbuf.set(this._mp4Box.vmhd, offset);
            offset += this._mp4Box.vmhd.length;

        } else if (track.codec.track === SBPTrack.audio) {

            track.mxbuf.set(this._mp4Box.smhd, offset);
            offset += this._mp4Box.smhd.length;
        }

        // dinf
        track.mxbuf.set(this._mp4Box.dinf, offset);
        offset += this._mp4Box.dinf.length;

        // stbl
        offset = this._buildBox(track, this._mp4Box.stbl, offset, total - offset);

        // stsd
        var bw, stsdSize;

        switch (track.codec.id) {

            case SBPCodec.avc.id:
                stsdSize = 121 + track.cfgblock[0].length + track.cfgblock[1].length;

                offset = this._buildBox(track, this._mp4Box.stsd, offset, stsdSize, true);
                offset = this._muxIntVal(track, offset, 1, 4); // entry
                stsdSize -= 16;

                offset = this._buildBox(track, this._mp4Box.avc1, offset, stsdSize, false);

                offset = this._zeroPadding(track, offset, 6); // reserved 6 bytes(0)
                offset = this._muxIntVal(track, offset, 1, 2); // count

                offset = this._zeroPadding(track, offset, 16); // reserved 16 bytes(0)

                offset = this._muxIntVal(track, offset, track.width, 2); // width
                offset = this._muxIntVal(track, offset, track.height, 2); // height

                offset = this._muxIntVal(track, offset, 0x480000, 4); // hres
                offset = this._muxIntVal(track, offset, 0x480000, 4); // vres

                offset = this._zeroPadding(track, offset, 4); // reserved 4 bytes(0)
                offset = this._muxIntVal(track, offset, 1, 2); // frame count.

                offset = this._zeroPadding(track, offset, 32); // reserved 32 bytes(0)

                offset = this._muxIntVal(track, offset, 0x18, 2); // depth
                offset = this._muxIntVal(track, offset, 0xffff, 2); // reserved.
                stsdSize -= 86;

                // avcC
                offset = this._buildBox(track, this._mp4Box.avcC, offset, stsdSize);

                track.mxbuf[offset++] = 0x1; // version=1
                track.mxbuf[offset++] = track.cfgblock[0][1]; // profile
                track.mxbuf[offset++] = track.cfgblock[0][2]; // compatibility
                track.mxbuf[offset++] = track.cfgblock[0][3]; // level
                track.mxbuf[offset++] = 0xff; // header size=4

                track.mxbuf[offset++] = 0xe1; // SPS count (1 & 0xe0)
                offset = this._muxIntVal(track, offset, track.cfgblock[0].length, 2); // SPS Length

                track.mxbuf.set(track.cfgblock[0], offset); // SPS
                offset += track.cfgblock[0].length;

                track.mxbuf[offset++] = 0x1; // PPS count
                offset = this._muxIntVal(track, offset, track.cfgblock[1].length, 2); // PPS Length

                track.mxbuf.set(track.cfgblock[1], offset); // PPS
                offset += track.cfgblock[1].length;
                break;

            case SBPCodec.mpa.id:
                stsdSize = 90 + this._mp4Box.esdsCfg.length;

                offset = this._buildBox(track, this._mp4Box.stsd, offset, stsdSize, true);
                offset = this._muxIntVal(track, offset, 1, 4); // entry
                stsdSize -= 16;

                // mp4a
                offset = this._buildBox(track, this._mp4Box.mp4a, offset, stsdSize, false);

                offset = this._zeroPadding(track, offset, 6); // reserved 6 bytes(0)
                offset = this._muxIntVal(track, offset, 1, 2); // count

                offset = this._zeroPadding(track, offset, 8); // reserved 8 bytes(0)

                offset = this._muxIntVal(track, offset, track.channels, 2); // channel.
                offset = this._muxIntVal(track, offset, 16, 2); // bits per sample (AAC는 16bit 고정)

                offset = this._zeroPadding(track, offset, 4); // reserved 4 bytes(0)

                offset = this._muxIntVal(track, offset, track.sampleRate > 64000 ? 0 : track.sampleRate, 2); // Sample Rate << 16
                offset = this._zeroPadding(track, offset, 2); // << 16이므로 나머지는 0으로,
                stsdSize -= 36;

                // esds
                offset = this._buildBox(track, this._mp4Box.esds, offset, stsdSize, true);
                stsdSize -= 12;

                offset = this._esdsTag(track, offset, 0x3, stsdSize);
                stsdSize -= 5 + this._mp4Box.esdsCfg.length;

                offset = this._muxIntVal(track, offset, 2, 2); // esid
                track.mxbuf[offset++] = 0x1f; // priority (max)
                stsdSize -= 3;

                offset = this._esdsTag(track, offset, 0x4, stsdSize);
                stsdSize -= 5;

                track.mxbuf[offset++] = 0x6b; // MPA (6b)
                track.mxbuf[offset++] = 0x15; // audio (21)
                offset = this._muxIntVal(track, offset, 0x10000, 3); // buffer size

                bw = 128; // default 128Kbps

                if (track.stat.firstdts !== -1 && (track.stat.lastdts - track.stat.firstdts) > 0) {

                    // 현재까지의 값으로 일단 비트레이트를 추정한다.
                    // 오디오의 경우 거의 CBR이므로 유사치로 판단.
                    bw = (track.stat.bytes * track.tscale / (track.stat.lastdts - track.stat.firstdts + track.tick) / 125) >> 4 << 4;
                }

                offset = this._muxIntVal(track, offset, bw * 1000, 4); // average bps.
                offset = this._muxIntVal(track, offset, bw * 2000, 4); // max bps.
                stsdSize -= 13;

                track.mxbuf.set(this._mp4Box.esdsCfg, offset);
                offset += this._mp4Box.esdsCfg.length;
                break;

            case SBPCodec.aac.id:
                stsdSize = 95 + this._mp4Box.esdsCfg.length + track.cfgblock[0].length;

                offset = this._buildBox(track, this._mp4Box.stsd, offset, stsdSize, true);
                offset = this._muxIntVal(track, offset, 1, 4); // entry
                stsdSize -= 16;

                // mp4a
                offset = this._buildBox(track, this._mp4Box.mp4a, offset, stsdSize, false);

                offset = this._zeroPadding(track, offset, 6); // reserved 6 bytes(0)
                offset = this._muxIntVal(track, offset, 1, 2); // count

                offset = this._zeroPadding(track, offset, 8); // reserved 8 bytes(0)

                offset = this._muxIntVal(track, offset, track.channels, 2); // channel.
                offset = this._muxIntVal(track, offset, 16, 2); // bits per sample (AAC는 16bit 고정)

                offset = this._zeroPadding(track, offset, 4); // reserved 4 bytes(0)

                offset = this._muxIntVal(track, offset, track.sampleRate > 64000 ? 0 : track.sampleRate, 2); // Sample Rate << 16
                offset = this._zeroPadding(track, offset, 2); // << 16이므로 나머지는 0으로,
                stsdSize -= 36;

                // esds
                offset = this._buildBox(track, this._mp4Box.esds, offset, stsdSize, true);
                stsdSize -= 12;

                offset = this._esdsTag(track, offset, 0x3, stsdSize);
                stsdSize -= 5 + this._mp4Box.esdsCfg.length;

                offset = this._muxIntVal(track, offset, 2, 2); // esid
                track.mxbuf[offset++] = 0x1f; // priority (max)
                stsdSize -= 3;

                offset = this._esdsTag(track, offset, 0x4, stsdSize);
                stsdSize -= 5;

                track.mxbuf[offset++] = 0x40; // AAC (40)
                track.mxbuf[offset++] = 0x15; // audio (21)
                offset = this._muxIntVal(track, offset, 0x10000, 3); // buffer size

                bw = 128; // default 128Kbps

                if (track.stat.firstdts !== -1 && (track.stat.lastdts - track.stat.firstdts) > 0) {

                    // 현재까지의 값으로 일단 비트레이트를 추정한다.
                    // 오디오의 경우 거의 CBR이므로 유사치로 판단.
                    bw = (track.stat.bytes * track.tscale / (track.stat.lastdts - track.stat.firstdts + track.tick) / 125) >> 4 << 4;
                }

                offset = this._muxIntVal(track, offset, bw * 1000, 4); // average bps.
                offset = this._muxIntVal(track, offset, bw * 2000, 4); // max bps.
                stsdSize -= 13;

                offset = this._esdsTag(track, offset, 0x5, stsdSize);

                track.mxbuf.set(track.cfgblock[0], offset);
                offset += track.cfgblock[0].length;

                track.mxbuf.set(this._mp4Box.esdsCfg, offset);
                offset += this._mp4Box.esdsCfg.length;
                break;
        }

        // stbl sub box (stts, stsc, stco, stsz)
        track.mxbuf.set(this._mp4Box.stblSubChunk, offset);
        track.msesb.appendBuffer(track.mxbuf.subarray(0, total));
        return SBPError.success;
    };

    this._zeroPadding = function(track, offset, len) {

        while (len--) track[offset++] = 0x0;
        return offset;
    };

    this._muxIntVal = function(track, offset, val, size) {

        var i, j;

        for (i = 0, j = (size - 1) * 8; i < size; i++, j -= 8) {

            track.mxbuf[offset] = (val >>> j) & 0xFF;
            offset++;
        }

        return offset;
    };

    this._buildBox = function(track, box, offset, size, ext, ver, flag) {

        if(ext === undefined) ext = false;
        if(ver === undefined) ver = 0;
        if(flag === 0) flag = 0;

        offset = this._muxIntVal(track, offset, size, 4);

        track.mxbuf.set(box, offset);
        offset += 4;

        if (ext) {

            track.mxbuf[offset] = ver;
            offset++;

            offset = this._muxIntVal(track, offset, flag, 3);
        }

        return offset;
    };

    // 시작 기준 DTS를 구한다.
    // MSE와 연동을 위해서는 시작 Timestamp가 0으로 설정해 주어야 한다.
    // 라이브의 경우 그렇지 않으므로, 시작 기준 DTS를 구하고, 모든 DTS/PTS에 대해 시작 기준 DTS의 상대 값으로 처리해야 한다.
    this._getGlobalBaseDts = function() {

        if (this.cbd) return;

        var i, gdur, gfd, gbd = -1;

        for (i = 0; i < this.tracks.length; i++) {

            if (this._isAvTrack(this.tracks[i])) {

                gfd = this.tracks[i].stat.firstdts * 90000 / this.tracks[i].tscale;

                if (gbd === -1) gbd = gfd;
                else if (gbd > gfd) gbd = gfd;
            }
        }

        // 전체 재생 시간도 재설정 해준다. (VOD의 경우)

        if (!this.isLive()) {

            gdur = this._ms.duration * 90000;
            if (gdur > 0 && gbd > 0 && gdur > gbd) this._ms.duration = (gdur - gbd) / 90000;
        }

        // 새롭게 계산된 시작 기준 값으로 각 트랙의 firstdts를 재설정해준다.
        for (i = 0; i < this.tracks.length; i++) {

            this.tracks[i].stat.firstdts = gbd * this.tracks[i].tscale / 90000;
        }

        this.cbd = true;
    };

    this._segmentDuration = function() {

        return (this.isLive() || this.config.sbSegmentDuration > 2) ? this.config.sbSegmentDuration : 2;
    };

    // 세그먼트 포인트인지를 검사하고,
    // 세그먼트이면 세그먼트를 빌드하고 세그먼트 큐에 추가합니다.
    // 아직 MSE 미디어 소스 버퍼가 생성되지 않은 상태이면, 초기화도 수행합니다.
    this._segment = function(track, dts, ft) {

        if (dts === -1) {

            // Split 포인트일 경우(Seek 혹은 라이브 Resume에 의한)
            // 아직 초기화가 되지 않은 상태이면, 세그먼트 빌드는 생략한다.
            if (ft === SBPFrameType.split && track.msesb == null) {

                track.mxfrms = null;
                return true;
            }

            dts = track.mxfrms[track.mxfrms.length - 1].dts + track.tick;
        }

        var dur = dts - track.mxfrms[0].dts;

        // 이전 위치로 Seek가 된 상태다. 현재까지 추가된 프레임들은 모두 버린다.
        if (dur < 0) {

            track.mxfrms = null;
            return true;
        }

        if (ft !== SBPFrameType.split && ft !== SBPFrameType.eof && dur < this._segmentDuration() * track.tscale) return false;

        this._getGlobalBaseDts();

        ////// 세그먼트 Moof 먹싱 처리 /////////
        var boxSize = 84 + (track.codec.track === SBPTrack.video ? 0 : 4) + (track.mxfrms.length * (track.codec.track === SBPTrack.video ? 16 : 8));
        var i, offset, start;

        start = offset = track.mdat - boxSize;

        // moof
        offset = this._buildBox(track, this._mp4Box.moof, offset, boxSize);

        // mfhd
        offset = this._buildBox(track, this._mp4Box.mfhd, offset, 16, true, 0, 0);
        offset = this._muxIntVal(track, offset, track.sseq, 4); // segment sequence (moof sequence, 1~)

        // traf
        offset = this._buildBox(track, this._mp4Box.traf, offset, boxSize - (offset - start));

        // tfhd
        offset = this._buildBox(track, this._mp4Box.tfhd, offset, 16 + (track.codec.track === SBPTrack.video ? 0 : 4), true, 0, (track.codec.track === SBPTrack.video ? 0 : 0x20/*sample flag present*/));
        offset = this._muxIntVal(track, offset, 1, 4); // track id
        if (track.codec.track !== SBPTrack.video) offset = this._muxIntVal(track, offset, 0, 4); // default sample flag(0)

        // tfdt
        // 반드시 32bit형으로 지원해야 한다. ver=1(64bit)는 지원하지 않음. ㅠㅠ
        offset = this._buildBox(track, this._mp4Box.tfdt, offset, 16, true, 0, 0);
        offset = this._muxIntVal(track, offset, track.mxfrms[0].dts - track.stat.firstdts, 4); // track id

        // trun
        offset = this._buildBox(track, this._mp4Box.trun, offset, 20 + (track.mxfrms.length * (track.codec.track === SBPTrack.video ? 16 : 8)), true, 0, (track.codec.track === SBPTrack.video ? 0x0f01 : 0x0301));
        offset = this._muxIntVal(track, offset, track.mxfrms.length, 4); // count
        offset = this._muxIntVal(track, offset, track.mdat + 8 - start, 4); // offset


        // trun entry
        for (i = 0; i < track.mxfrms.length; i++) {

            var tick = (i === (track.mxfrms.length - 1) ? dts : track.mxfrms[i + 1].dts) - track.mxfrms[i].dts;

            if (tick > 90000) {

                this.logger.put(SBPLogLevel.warning, SBPLogSection.engine, track.codec.track.desc + " tick overflow=" + tick + ", " + (i + 1) + "/" + track.mxfrms.length + ", next dts=" + dts + ", frame=" + track.mxfrms[i].dts + ", track_tick=" + track.tick);
            }

            offset = this._muxIntVal(track, offset, tick, 4); // duration
            offset = this._muxIntVal(track, offset, track.mxfrms[i].size, 4); // size

            if (track.codec.track === SBPTrack.video) {

                offset = this._muxIntVal(track, offset, (track.mxfrms[i].ft === SBPFrameType.key ? 0 : 0x010000), 4); // flag
                offset = this._muxIntVal(track, offset, track.mxfrms[i].pts - track.mxfrms[i].dts, 4); // cts
            }
        }

        // mdat
        this._buildBox(track, this._mp4Box.mdat, offset, track.nfo - track.mdat);

        if(!track.mxfrms[0].skip) {

            // 세그먼트 먹싱 버퍼에서 moof 박스 시작점과 mdat 박스 끝지점까지를 잘라 복사하여 세그먼큐 리스트에 추가한다.
            track.queue.push({
                seq: track.sseq,
                base: (track.mxfrms[0].dts - track.stat.firstdts),
                next: (dts - track.stat.firstdts),
                data: SBPUtil.memdup(track.mxbuf, start, track.nfo),
            });
        }

        // 다음 세그먼트를 위해 먹싱 초기화
        track.mxfrms = null;
        track.sseq++;

        if (track.msesb == null && this._checkStartCondition() === SBPError.success) {

            // !시작 기점
            // 현재 먹싱된 세그먼트가 sbStartSegmentCount 이상이거나, EOF 세그먼트(null)가 존재한다면,

            // MSE 미디어 소스 버퍼 생성 및 초기화
            // 정상적으로 초기화되었으면 그 이후로는 'updateend' 시에 먹싱된 세그먼트를 순차적으로 내보낸다.

            var res;
            if ((res = this._init()) !== SBPError.success) throw res;

        } else if (track.msesb != null && track.na) {

            track.na = false;
            this._onSourceBufferUpdateEnd(track);
        }

        return true;
    };

    this._checkStartCondition = function() {

        for (var i = 0; i < this.tracks.length; i++) {

            if (this._isAvTrack(this.tracks[i]) && this.tracks[i].queue.length <= this.config.sbStartSegmentCount && this.tracks[i]._eof === false) {

                return SBPError.wait;
            }
        }

        return SBPError.success;
    };

    this._secondOf = function(track, ts) {

        return (ts / track.tscale).toFixed(3);
    };

    // 프레임을 현재(마지막) 세그먼트에 먹싱합니다.
    this._muxFrame = function(track, data, start, end, dts, pts, ft, skipmux) {

        if (ft === SBPFrameType.eof) {

            if (track.mxfrms != null) this._segment(track, -1, ft);

            // 맨 마지막에 null을 세그먼트 큐에 추가한다.(null == EOF)
            track.queue.push({seq: -1, data: null});
            track._eof = true;

            return SBPError.success;

        } else if (ft === SBPFrameType.split) {

            if (track.mxfrms != null) {

                this.logger.put(SBPLogLevel.stat, SBPLogSection.engine, track.codec.track.desc + " segmenting remain frames(" + track.mxfrms.length + ") before split");
                this._segment(track, -1, ft);
            }

            this.logger.put(SBPLogLevel.stat, SBPLogSection.engine, track.codec.track.desc + " sequence split point");

            track.dison = true;

            return SBPError.success;
        }

        if (this._isAvTrack(track)) {

            if (track.mxfrms == null) {

                if (track.mxbuf == null) {

                    // 먹싱 버퍼를 설정한다. 먹싱 버퍼는 최대 크기를 예상하여 고정 크기로 잡아둔다.
                    // 먹싱 후 .subarray()로 세그먼트 추출

                    var mxbufsize;

                    if (track.codec.track === SBPTrack.video) mxbufsize = 2500000; // 최대 20Mbps 기준
                    else mxbufsize = 64000; // 최대 512Kbps 기준

                    mxbufsize = Math.round(mxbufsize * this._segmentDuration() * 2 + 8/*mdat*/);

                    // 최대 초당 120프레임 기준으로 Moof 사이즈를 예상/책정한다.
                    track.mdat = 84 + // 기본 사이즈(moof + mfhd + traf + tfhd + tfdt + trun(헤더만) box)
                        (track.codec.track === SBPTrack.video ? 0 : 4) +  // 비디오가 아니면 tfhd 박스에 sample flag(4bytes)를 추가한다.
                        (Math.round(120 * this._segmentDuration()) * (track.codec.track === SBPTrack.video ? 16 : 8));

                    mxbufsize = mxbufsize + track.mdat;
                    track.mxbuf = new Uint8Array(mxbufsize);

                    this.logger.put(SBPLogLevel.stat, SBPLogSection.engine, track.codec.track.desc + " muxing buffer alloc " + Math.round(mxbufsize / 1024) + " Kbytes(moof=" + track.mdat + "/mdat=" + (mxbufsize - track.mdat) + ")");
                }

                // 프레임 리스트 및 기준 Offset은 초기화
                track.mxfrms = [];
                track.nfo = track.mdat + 8;

            } else {

                try {

                    if (this._segment(track, dts, ft)) {

                        return this._muxFrame(track, data, start, end, dts, pts, ft, skipmux);
                    }

                } catch (e) {

                    this.logger.put(SBPLogLevel.stat, SBPLogSection.engine, e);
                    track.mxfrms = null;
                    return e;
                }
            }

            var size = end - start;

            track.mxfrms.push({offset: track.nfo, size: size, dts: dts, pts: pts, ft: ft, skip: skipmux });

            try {
                track.mxbuf.set(data.subarray(start, end), track.nfo);

            } catch (e) {

                return SBPError.muxOverflow;
            }

            track.nfo = track.nfo + size;

            if (track.lastdts > dts) {

                this.logger.put(SBPLogLevel.warning, SBPLogSection.engine, track.codec.track.desc + "dts(" + this._secondOf(track, dts) + ") less than last(" + SBPSource._secondOf(track, track.lastdts) + ")");
            }

            track.stat.bytes += size;
            if (track.stat.firstdts === -1) track.stat.firstdts = dts;
            track.stat.lastdts = dts;
            track.discon = false;

        } else { // text or meta data

            track.queue.push({dts: dts, pts: pts, data: SBPUtil.memdup(data, start, end),});
        }

        return SBPError.success;
    };

    this._parseID3 = function(data) {

        if (data.length <= 10 || data[0] !== 0x49 || data[1] !== 0x44 || data[2] !== 0x33) return null;

        var offset = 10;
        var size = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f);

        if ((data[5] & 0x40) !== 0) {

            if (data.length <= 14) return null;
            offset += ((data[10] & 0x7f) << 21) | ((data[11] & 0x7f) << 14) | ((data[12] & 0x7f) << 7) | (data[13] & 0x7f);
        }

        if (data.length >= offset + size) {

            var fsize;
            var frame = [];

            for (var i = offset; i < data.length;) {

                fsize = ((data[i + 4] & 0x7f) << 21) | ((data[i + 5] & 0x7f) << 14) | ((data[i + 6] & 0x7f) << 7) | (data[i + 7] & 0x7f);

                if (data[i] === 0x54) { // 'T'로 시작하는 모든 프레임

                    var txt = null;

                    if (data[i + 10] === 0x00) txt = new TextDecoder("iso-8859-1").decode();
                    else if (data[i + 10] === 0x01) txt = new TextDecoder("utf-16").decode(data.subarray(i + 11, i + fsize + 10));
                    else if (data[i + 10] === 0x02) txt = new TextDecoder("utf-16be").decode(data.subarray(i + 11, i + fsize + 10));
                    else if (data[i + 10] === 0x03) txt = new TextDecoder("utf-8").decode(data.subarray(i + 11, i + fsize + 10));

                    if (txt) frame.push({frame: new TextDecoder("utf-8").decode(data.subarray(i, i + 4)), data: txt,});

                } else { // 그 외의 프레임은 일단 바이너리로

                    frame.push({
                        frame: new TextDecoder("utf-8").decode(data.subarray(i, i + 4)),
                        data: SBPUtil.memdup(data, i + 10, i + fsize + 10),
                    });
                }

                i += fsize + 10;
            }

            if (frame.length > 0) return frame;
        }

        return null;
    };

    // 0.1초 마다 체크하여 아래의 사항을 체크한다.
    //
    // - 입력부가 홀딩되어 있는 경우 버퍼링 상태를 확인하여 수용 조건에 맞으면 입력 재게를 허용
    // - 텍스트 메타 데이터를 체크하여 현재 재생 시간과 매치될 경우 이벤트 발생
    //
    this._monitor = function() {

        if (this._ms.readyState !== "open") return;

        if (this.mainTrack && this.mainTrack._eof) {

            if (this.video.currentTime >= Math.floor((this.mainTrack.stat.lastdts - this.mainTrack.stat.firstdts) / this.mainTrack.tscale)) {

                this.endOfStream();
                return;
            }
        }

        var i;

        for (i = 0; i < this.tracks.length; i++) {

            if(this.tracks[i].nr && !this._isTrackOverflow(this.tracks[i])) {

                if(this.ev.resume) this.ev.resume.dispatch(this.tracks[i]);
            }
        }

        if (this.mainTrack && this.mainTrack.msesb && this._skbc > 0 && this._skbc !== this.mainTrack.msesb.buffered.length) {

            // 버퍼 구간의 갯수가 줄어 들었을 경우,
            // 진행에 따라 기존 버퍼 구간과 합쳐 졌으므로, 새로운 추가 위치를 계산하여 요청한다.
            this._changeAppendPosition(false);
        }

        // 텍스트, 메타 데이터 체크
        if (!this.video.seeking) { // seeking 중이면 판단 오류가 있을 수 있으므로 계산을 생략한다.

            var ipos;

            for (i = 0; i < this.tracks.length; i++) {

                if (!this._isAvTrack(this.tracks[i]) && this.tracks[i].queue.length > 0) {

                    if (this.tracks[i].searchBase < this.tracks[i].queue.length) {

                        ipos = ((this.tracks[i].queue[this.tracks[i].searchBase].pts - this.tracks[i].stat.firstdts) / this.tracks[i].tscale);

                        if (ipos <= this.video.currentTime) {

                            switch (this.tracks[i].codec.id) {

                                case SBPCodec.id3.id:

                                    if (this.ev.meta) {

                                        var id3 = this._parseID3(this.tracks[i].queue[this.tracks[i].searchBase].data);

                                        if (id3 != null) {
                                            this.ev.meta.dispatch({type: this.tracks[i].codec, data: id3});
                                        }
                                    }
                                    break;
                            }

                            if (this.isLive()) this.tracks[i].queue.shift(); // 라이브면 소비
                            else this.tracks[i].searchBase++; // VOD면 다음 대상으로 커서 이동
                        }
                    }
                }
            }
        }
    };

    // 현재 모든 SourceBuffer가 appended된 상태인지 검사 (초기 재생 시작 시 A/V Interleaved 체크 용)
    this._allAppended = function(bc) {

        for (var i = 0; i < this.tracks.length; i++) {

            if(this._isAvTrack(this.tracks[i])) {

                if(this.tracks[i].appended === false) return false;
                else if(bc) {

                    if(this.tracks[i].msesb == null || this.tracks[i].msesb.buffered.length === 0) return false;
                    else if(this.tracks[i].msesb.buffered.start(0) <= this.tracks[i].msesb.buffered.end(0)) return false;
                }

            }
        }

        return true;
    };

    this._readyFor = function() {

        if(this._newPos === -1) return true;
        else {

            return true;

            if(this.mainTrack) {

                for (var i = 0; i < this.mainTrack.msesb.buffered.length; i++) {

                    var bs, be;

                    bs = this.mainTrack.msesb.buffered.start(i);
                    be = this.mainTrack.msesb.buffered.end(i);

                    if (bs <= this._newPos && this._newPos <= be) return true;
                }
            }

            return false;
        }
    };

    // MSE 미디어 버퍼 'updateend' 리스너
    // 버퍼에 세그먼트를 추가하면, 'updatestart' -> 'updating' -> 'updateend'의 순으로 이벤트가 진행되며,
    // 'updateend' 이벤트 발생 후에 다음 세그먼트를 추가할 수 있습니다.
    this._onSourceBufferUpdateEnd = function(track) {

        if(this.eos) {

            if(this.eos === 1) this.endOfStream();
            return;
        }

        if(track.stopped) return;

        var aa = this._allAppended();

        if(aa && !this.ready) {

            if (this._readyFor()) {

                this.ready = true;
                if (this.ev.ready) this.ev.ready.dispatch();
            }

            if(this.mon == null) this.mon = window.setInterval(this._monitor.bind(this), 100);
        }

        if(track.appended && !aa) {

            // 다른 트랙의 Moof 세그먼트가 아직 추가되지 않았다면,
            // 대기한다. 다음 세그먼트 추가시 재시도
            track.na = true;
            return;
        }

        var node = track.queue.shift();

        if (node) {

            if (node.data == null) { // EOF

            } else {

                try {
                    track.msesb.appendBuffer(node.data);
                    track.appended = true;

                } catch(e) {

                    if(e.name === 'QuotaExceededError') {

                        track.queue.unshift(node);
                        track.na = true;
                    }
                }
            }

            node = null;

        } else if (!track._eof) {

            track.na = true;
        }
    };

    // MSE 미디어 버퍼 'error' 리스너
    this._onSourceBufferError = function(track, event) {

        if (track != null) {

            if (track.stopped) return;

            this.logger.put(SBPLogLevel.error, SBPLogSection.engine, "_onSourceBufferError(" + track.codec.track.desc + ")");
            this.logger.put(SBPLogLevel.error, SBPLogSection.engine, event);
        }

        for (var i = 0; i < this.tracks.length; i++) {

            this.tracks[i].stopped = true;
        }
    };

    /*
        새로운 데이터 추가 위치 계산 및 요청 함수
     */
    this._changeAppendPosition = function(seek) {

        var pos = this.video.currentTime;

        if (this.mainTrack) {

            this._skbc = this.mainTrack.msesb.buffered.length;

            for (var i = 0; i < this.mainTrack.msesb.buffered.length; i++) {

                var bs, be;

                bs = this.mainTrack.msesb.buffered.start(i);
                be = this.mainTrack.msesb.buffered.end(i);

                if (bs <= this.video.currentTime && this.video.currentTime <= be) {

                    pos = be;
                    break;
                }
            }
        }

        this.logger.put(SBPLogLevel.stat, SBPLogSection.engine, "request seeking pos=" + pos + ", sweep=" + (!seek));

        // 6. 입력 부에 입력 데이터의 위치 조정(pos)을 요청한다.
        if (this.ev.seek) this.ev.seek.dispatch({pos: pos, sweep: (!seek)});
    };
}

SBPSource.prototype.destroy = function() {

    for (var key in this.ev) {

        if (this.ev[key] != null) this.ev[key].destroy();
        this.ev[key] = null;
    }

    this.stop();

    this.video.removeEventListener('seeking', this.pps);
    this.tracks = null;
    this.config = this.logger = null;
    this.video = null;

    if (this.ev.resume != null) this.ev.resume.destroy();
    if (this.ev.ready != null) this.ev.ready.destroy();
    if (this.ev.meta != null) this.ev.meta.destroy();
    if (this.ev.text != null) this.ev.text.destroy();
    if (this.ev.seek != null) this.ev.seek.destroy();
    if (this.ev.restart != null) this.ev.restart.destroy();

    this.ev = null;
};

/*
    소스 버퍼를 리셋(초기화)한다.
 */
SBPSource.prototype.stop = function() {

    this.video.removeEventListener('seeking', this.ve.seeking);
    this.video.removeEventListener('pause', this.ve.paused);
    this.video.removeEventListener('playing', this.ve.playing);

    if(this.mon) {

        window.clearInterval(this.mon);
        this.mon = null;
    }

    for(var i = 0; i < this.tracks.length; i++) {

        if(this.tracks[i].msesb !== undefined) {

            try {

                this.tracks[i].msesb.abort();
                this.tracks[i].msesb.removeSourceBuffer('updateend', this.tracks[i].oue);
                this.tracks[i].msesb.removeSourceBuffer('error', this.tracks[i].oe);

                this._ms.removeSourceBuffer(this.tracks[i].msesb);

            } catch(e) {

            }

            this.tracks[i].msesb = null;
        }
    }

    this._ms = null;
    this.tracks = [];
    this.mainTrack = null;
    this.ready = false;
    this.cbd = false;
};

/*
    이벤트 리스너를 등록한다.

    @param
    event(SBPEvent): 대상 이벤트
    listener: 리스너

    @remark
    가능한 이벤트는 아래와 같다.

        SBPEvent.sbResume

 */
SBPSource.prototype.addEventListener = function(event, listener) {

    if(event === SBPEvent.sbResume) {

        this.ev.resume = new SBPEventHandler(event,listener);

    } else if(event === SBPEvent.sbReady) {

        this.ev.ready = new SBPEventHandler(event, listener);

    } else if(event === SBPEvent.sbMetaOut) {

        this.ev.meta = new SBPEventHandler(event, listener);

    } else if(event === SBPEvent.sbTextOut) {

        this.ev.text = new SBPEventHandler(event, listener);

    } else if(event === SBPEvent.sbSeek) {

        this.ev.seek = new SBPEventHandler(event, listener);

    } else if(event === SBPEvent.sbRestart) {

        this.ev.restart = new SBPEventHandler(event, listener);
    }
};

/*
    트랙 정보를 조회하거나 추가한다.

    @param
    codec(SBPCodec): 대상 코덱
    tscale(정수형): 타임 스케일 (기본값 90000Hz)

    @return
    트랙(Object)

    @remark
    대상 트랙이 없는 경우 새로 생성하여 리턴한다.
 */
SBPSource.prototype.trackOf = function(codec, tscale) {

    if(tscale === undefined) tscale = 90000;

    for(var i = 0; i < this.tracks.length; i++) {

        if(this.tracks[i].codec === codec) return this.tracks[i];
    }

    var track = {

        key: this.tracks.length,
        nr: false,
        codec: codec,
        tscale: tscale,
        stat: { bytes: 0, firstdts: -1, lastdts: 0, },
        tick: 0,
        cfgblock: [ null, null, null, ],
        queue : [],     // 세그먼트 큐
        eof : false,
        discon : true,
        init : false,

        // MSE SourceBuffer 관련
        msesb: null,    // MSE SourceBuffer Object
        na : false,     // true면 세그먼트 먹싱 즉시 append 해야함, false면 이벤트 핸들러에서 처리
        stopped: false,
        appended : false,

        // 먹싱관련
        mxbuf : null,   // 먹싱 버퍼
        mxfrms : null,  // 먹싱된 프레임 리스트
        mdat : 8,       // 먹싱 버퍼 상에서 'mdat'의 위치
        nfo : 8,        // 'mdat' 박스 내 다음 프레임의 위치
        sseq : 1,       // 세그먼트 시퀀스

        // 메타 데이터 / 텍스트 관련
        searchBase: 0,

        oue : function(event) {

            this._onSourceBufferUpdateEnd(track, event);

        }.bind(this),

        oe : function(event) {

            this._onSourceBufferError(track, event);

        }.bind(this),
    };

    this.tracks.push(track);
    return track;
};

/*
    트랙의 Codec Configuration Block을 추가(교체)한다.

    @param
    codec(SBPCodec) : 대상 코덱
    idx(정수형(0~2)) : 대상 Configuration Block의 인덱스
    buf(Uint8Array) : 추가(교체)할 Configuration Block

    @remark
    파라미터 idx의 의미는 각 코덱에 따라 아래와 같다.

        SBPCodec.aac:

                0 : AudioSpecificConfig (ISO 14496-3)
                1 : reserved
                2 : reserved

        SBPCodec.avc:

                0 : SPS Nal
                1 : PPS Nal

 */
SBPSource.prototype.setConfigBlock = function(codec, idx, buf) {

    var track = this.trackOf(codec);

    if(track) {

        track.cfgblock[idx] = buf;
    }
};

/*
    A/V 프레임을 추가한다.

    @param
    codec(SBPCodec) : 코덱
    data(Uint8Array) : 데이터
    offset(정수형) : 데이터의 시작 offset
    size(정수형) : 데이터의 크기
    dts(정수형): 디코딩 타임스탬프
    pts(정수형): 프리젠테이션 타임스탬프
    ft(SBPFrameType) : 프레임 타입

    @return
    SBPError

    @remark
    데이터 포맷은 각 코덱에 따라 아래와 같다.

        SBPCodec.mpa : MP3 Raw
        SBPCodec.aac: AAC Raw
        SBPCodec.avc: Network Stream NAL Units

    AVC의 경우 별도의 Configuration 설정(setConfigBlock)을 하지 않은 경우
    Key 프레임에 SPS, PPS Nal이 포함되어 있어야 한다.
 */
SBPSource.prototype.addFrame = function(codec, data, start, end, dts, pts, ft, skipmux) {

    var track = this.trackOf(codec);

    if(ft === SBPFrameType.eof || ft === SBPFrameType.split) return this._muxFrame(track, data, start, end, dts, pts, ft, skipmux);

    switch(track.codec.id) {

        case SBPCodec.mpa.id:
            if(track.sampleRate === undefined || track.channels === undefined) {

                this.logger.put(SBPLogLevel.error, SBPLogSection.engine, "MP3 information(Hz, Ch) not defined");
                return SBPError.avConfig;
            }
            break;

        case SBPCodec.aac.id:

            // * 최소한 오디오 샘플레이트, 채널 정보는 이전에 미리 설정되어 있어야 한다.
            if(track.sampleRate === undefined || track.channels === undefined) {

                this.logger.put(SBPLogLevel.error, SBPLogSection.engine, "AAC information(Hz, Ch) not defined");
                return SBPError.avConfig;
            }

            if(track.objType === undefined) track.objType = 2;

            // 트랙에 오디오 AudioSpecificConfig가 존재하지 않는 경우 새로 생성한다.
            if(track.cfgblock[0] == null || track.cfgblock[0].length === 0) {

                var sri = SBPAudio.sampleRateIndex(track.sampleRate / ((track.objType === 5 || track.objType === 29) ? 2 : 1));

                track.cfgblock[0] = new Uint8Array(2);
                track.cfgblock[0][0] = (2 << 3) | (sri >> 1); // Object Type은 2(LC)로 고정, Chrome에서 오류 발생
                track.cfgblock[0][1] = (track.channels << 3) | ((sri & 0x1) !== 0 ? 0x80 : 0x0);
            }

            if(track.sampleBits === undefined) track.sampleBits = 16;
            break;

        case SBPCodec.avc.id:
            {
                var idrFound = false, nalsize, naltype, i = start;

                while (!idrFound && i < end) {

                    nalsize = ((data[i] & 0xff) << 24) | ((data[i + 1] & 0xff) << 16) | ((data[i + 2] & 0xff) << 8) | (data[i + 3] & 0xff);
                    i += 4;

                    naltype = data[i] & 0x1f;

                    switch (naltype) {

                        case 7: // SPS
                            // 트랙에 오디오 AVC Configuration Block 및 코덱 정보가 존재하지 않는 경우 새로 생성한다.
                            if (track.profile === undefined || track.level === undefined ||
                                track.width === undefined || track.height === undefined ||
                                track.cfgblock[0] == null) {

                                track.cfgblock[0] = SBPUtil.memdup(data, i, i + nalsize);
                                SBPAvc.parseSps(track.cfgblock[0], 1, track.cfgblock[0].length - 1, track);
                            }
                            break;

                        case 8: // PPS
                            if (track.cfgblock[1] == null) {

                                track.cfgblock[1] = SBPUtil.memdup(data, i, i + nalsize);
                            }
                            break;

                        case 1: // None IDR
                        case 5: // IDR

                            // 먹싱 대상은 IDR, None IDR부터 적용한다.
                            // 제외될 수 있는 대상은 AU, SEI, SPS, PPS Nal
                            start = i - 4;
                            idrFound = true;
                            break;
                    }

                    i += nalsize;
                }

                if(track.cfgblock[0] == null || track.cfgblock[1] == null) {

                    this.logger.put(SBPLogLevel.warning, SBPLogSection.engine, "skip AVC frame because configuration isn't initialized yet");
                    return SBPError.success;

                } else if(!idrFound) {

                    this.logger.put(SBPLogLevel.warning, SBPLogSection.engine, "skip AVC frame because couldn't found IDR or None IDR Nal");
                    return SBPError.success;
                }
            }
            break;
    }

    this._updateTick(track, dts);
    return this._muxFrame(track, data, start, end, dts, pts, ft, skipmux);
};

/*
    내부 세그먼트 버퍼가 초과된 상태인지 아닌지를 판단한다.

    @return
    내부 세그먼트 버퍼의 여유가 있고, 추가 입력(버퍼)가 가능하면 true를, 그렇지 않으면 false를 리턴한다.

    @remark
    입력단은 현재 버퍼된 세그먼트의 수가 sbSegmentMax를 초과하면 세그먼트가 서비될 때까지 기다려야 하며,
    이후 sbResume 이벤트를 기다려야 한다.
    초과시에도 본 메서드를 호출하지 않으면 sbResume 이벤트는 발생하지 않으며, 계속 입력이 들어오면
    초과된 상태로 진행된다.
 */
SBPSource.prototype.isAcceptableNextSegment = function(keys) {

    if((!this.isLive() || this.video.paused) && this.config.sbBufferRange.back > 0) {

        var cnt = 0;

        for (var i = 0; i < keys.length; i++) {

            for (var j = 0; j < this.tracks.length; j++) {

                if (this.tracks[j].key === keys[i] && this._isAvTrack(this.tracks[j])) {

                    if(this._isTrackOverflow(this.tracks[j])) {

                        this.tracks[j].nr = true;
                        cnt++;
                    }
                }
            }
        }

        if(cnt) return false;
    }

    return true;
 };

 /*
    해당 키(key)의 트랙 다운로드 중지를 해제한다.

  */
 SBPSource.prototype.resumeTrack = function(key) {

     for (var i = 0; i < this.tracks.length; i++) {

         if (this.tracks[i].key === key) {
             this.tracks[i].nr = false;
             break;
         }
     }
};

/*
    MediaSource endOfStream을 안전하게 호출하기 위한 함수.

 */
SBPSource.prototype.endOfStream = function() {

    if(this._ms == null) return;

    try {

        this._ms.endOfStream();
        this.eos = 2;


    } catch(e) {

        this.eos = 1; // 다음 "updateend" 콜백에서 재시도
    }

};

SBPSource.prototype.isLive = function() {

    return this._ms == null || this._ms.duration === Infinity || this._ms.duration === 0 || isNaN(this._ms.duration);
};

