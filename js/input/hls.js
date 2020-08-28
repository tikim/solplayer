
var SBPHlsTarget = {
  
    manifest: 1,
    segment: 2,
};

function SBPHlsSegment(hls, strm)
{
    this._hls = hls;
    this._stream = strm;
    this.config = this._hls.config;
    this.logger = this._hls.logger;

    this._url = null;
    this._duration = 0;

    this.loader = null;
    this.oml = null;
    this.osl = null;
    this.uth = null;

    this.cb = { endlist: null, error: null, };
    this._target = SBPHlsTarget.manifest;

    this._pstats = null;
    this._tracks = null;
    this._lc = null;
    this._stopped = false;

    this.segments = {

        avedur : undefined,

        seq : {
            last: undefined,
            load: -1,
        },

        list: [],
    };

    Object.defineProperty(this, 'src', {

        set: function(src) {

            this._src = src;
        },
    });

    Object.defineProperty(this, 'newPos', {

        set: function(pos) {

            console.log("switching for pos=" + pos);
            this._newPos = pos;
        },
    });

    this._onUpdate = function() {

        this._target = SBPHlsTarget.manifest;
        this.loader.load(this._url, false, this.config.hlsHttpRetry - 1, this.config.hlsHttpRetryInterval);
    };

    this._onDownloadSuccess = function(event) {

        if(this._target === SBPHlsTarget.manifest) { // 매니패스트 다운로드인 경우

            var txt = event.currentTarget.responseText, url = event.currentTarget.responseURL;

            if(url !== undefined) {

                this._url = url;
            }

            if(txt.indexOf('#EXTM3U') === -1 || txt.indexOf('#EXTINF:') === -1) {

                // M3U8 엣지 매니패스트가 아니다.
                if(this.cb.error) this.cb.error.dispatch({ error:SBPError.unknownData, url:this._url});

            } else {

                if(!this._stream.active) {

                    this._stream.active = true;

                    this._src.addEventListener(SBPEvent.sbResume, this._onResume.bind(this));
                    this._src.addEventListener(SBPEvent.sbSeek, this._onSeek.bind(this));
                }

                this._parseEdgeManifest(txt);
            }

        } else { // 세그먼트 다운로드인 경우

            this._proceedDownloadSegment(event.currentTarget.response);
        }
    };

    this._onDownloadError = function() {

        if(this._target === SBPHlsTarget.manifest) {

            if (this.cb.error) this.cb.error.dispatch({ error: SBPError.get, url: this._url});

        } else this._proceedDownloadSegment(null);
    };

    // 세그먼트 리스트를 포함하고 있는 M3U8 매니패스트 파싱
    this._parseEdgeManifest = function(txt) {

        var seq = 0,
            nsc = 0,
            regexp = /(?:#EXT-X-(MEDIA-SEQUENCE):(\d+))|(?:#EXT-X-(TARGETDURATION):(\d+))|(?:#EXT(INF):([\d.]+)[^\r\n]*[\r\n]+([^\r\n]+)|(?:#EXT-X-(ENDLIST))|(?:#EXT-X-(DIS)CONTINUITY))/g,
            result;

        while((result = regexp.exec(txt)) !== null) {

            result.shift();
            result = result.filter(function(n){ return (n !== undefined);});

            switch(result[0]) {

                case 'MEDIA-SEQUENCE':
                    seq = parseInt(result[1]);
                    break;

                case 'ENDLIST':
                    if(this.cb.endlist) this.cb.endlist.dispatch(this._duration);
                    break;

                case 'INF':
                    if(this._addSegment(seq, parseFloat(result[1]), SBPUtil.resolveUrl(result[2], this._url))) nsc++;
                    seq++;
                    break;

                default:
                    break;
            }
        }

        // 새로 추가된 세그먼트가 있으면,...
        if(nsc) {

            this.osl.dispatch();

        } else if(this._hls.live) {

            if(this.segments.list.length) {

                this.osl.dispatch();

            } else {

                this.uth = window.setTimeout(this._onUpdate.bind(this), Math.floor(this.segments.avedur * 250.));
            }
        }
    };

    // 세그먼트 리스트에 세그먼트를 추가한다.
    this._addSegment = function(seq, dur, url)
    {
        if(this.segments.avedur === undefined) this.segments.avedur = dur;
        else this.segments.avedur = (this.segments.avedur + dur) / 2.;

        if(this.segments.seq.last === undefined || seq > this.segments.seq.last) {

            this.segments.seq.last = seq;
            this.segments.list.push({seq: seq, base: this._duration, dur: dur, url: url});
            this._duration += dur;
            return true;
        }

        return false;
    };

    // 세그먼트를 로딩한다.
    this._onSegmentLoad = function() {

        if(this.segments.seq.load === -1) { // 첫번째 로딩 세그먼트가 정해지지 않은 경우,

            var i, j = 0;

            if(this._hls.live) { // 라이브일 경우

                if(this.config.hlsStartOffset >= 0) { // 절대 시작 시퀀스를 지정한 경우

                    // 시퀀스에 해당하는 세그먼트를 찾는다.
                    for(i = 0; i < this.segments.list.length; i++) {

                        if(this.segments.list[i].seq === this.config.hlsStartOffset) {

                            j = i;
                            break;
                        }
                    }

                } else if(this.segments.list.length > Math.abs(this.config.hlsStartOffset)) { // hlsStartOffset이 마이너스인 경우 맨 마지막에서 N번째

                    j = this.segments.list.length + this.config.hlsStartOffset;
                }
            }

            for(i = 0; i < j; i++) this.segments.list.shift();
            this.segments.seq.load = 0;
        }

        this._target = SBPHlsTarget.segment;
        this.loader.load(this.segments.list[this.segments.seq.load].url, true, this.config.hlsHttpRetry - 1, this.config.hlsHttpTimeout);
    };

    this._parseSegment = function(segment, payload) {

        //this.logger.put(SBPLogLevel.stat, SBPLogSection.input, "processing segment:seq=" + segment.seq + ", url=" + segment.url + ", at="+ Math.round(segment.base) +"sec");

        if(payload[0] === 0x47) {

            if(this._newPos !== -1 && this._newPos < segment.dur) this._newPos = -1;

            var res = this._parseTS(segment.seq, payload);

            if(this._newPos !== -1) {
                this._seek(this._newPos, true);
                this._newPos = -1;
            }

            return res;

        } else {

            this.logger.put(SBPLogLevel.error, SBPLogSection.input, "hls: MPEG2-TS illegal sync code=" + payload[0]);
            return SBPError.unknownData;
        }
    };

    this._proceedDownloadSegment = function(payload) {

        var result;

        if(payload == null) {

            // SBPlayer 소스 버퍼로부터 재개(resume) 이벤트가 들어옴.
            result = SBPError.success;

        } else {

            result = this._parseSegment(this.segments.list[this.segments.seq.load], new Uint8Array(payload));
        }

        if(result === SBPError.success) {

            this._stopped = false;

            if(this._hls.live) {

                // 다운로드한 세그먼트는 리스트에서 제거하고,
                this.segments.list.shift();

                // 현재 나머지 세그먼트의 갯수가 3 이하이면,
                if(this.segments.list.length < 3) {

                    // 매니패스트를 체크한다.
                    this.oml.dispatch();

                } else {

                    // 그렇지 않으면 다음 세그먼트 다운로드 계속 진행
                    this.osl.dispatch();
                }

            } else {

                if(this.segments.seq.load < this.segments.list.length - 1) {

                    // 다음 세그먼트 다운로드 진행
                    this.segments.seq.load++;
                    this._src.inputPosition = this.segments.list[this.segments.seq.load].base;
                    this.osl.dispatch();

                } else {

                    this._eof();
                }
            }

        } else if(result !== SBPError.wait) {

            if(this.cb.error) this.cb.error.dispatch({error:result, url:this.segments.list[this.segments.seq.load].url});

        } else {

            this._stopped = true;
        }
    };

    this._onResume = function(event) {

        var resume = false;
        var t = event.data;

        for(var i = 0; i < this._tracks.length; i++) {

            if(resume) {

                this._src.resumeTrack(this._tracks[i]);

            } else if(this._tracks[i] === t.key) {

                resume = true;
                this._src.resumeTrack(this._tracks[i]);
            }
        }

        if(resume && this._stopped) this._proceedDownloadSegment(null);
    };

    this._seek = function(pos, sweep) {

        if(this._hls.live) return;

        var newseq = this.segments.seq.load;

        // 새로운 위치(pos)에 대한 다음 세그먼트 대상을 설정한다.

        for(var i = 0; i < this.segments.list.length; i++) {

            if(pos <= this.segments.list[i].base) {

                if(pos === this.segments.list[i].base) {

                    // 같으면 바로 직전 세그먼트 부터
                    newseq = (i > 0 ? i - 1 : 0);

                } else {

                    // 그렇지 않으면 하나 더 직전,..
                    newseq = (i > 1 ? i - 2 : 0);
                }
                break;
            }
        }

        // * 버퍼 구간 정보 변경에 따른 위치 이동인 경우, 위치 전진(Foward)일 경우에만 변경을 시도한다.
        if(sweep && newseq <= this.segments.seq.load) return;

        this.logger.put(SBPLogLevel.stat, SBPLogSection.input, "change append position=(seq:"+this.segments.seq.load+"->"+newseq+") by requested position="+pos);
        this.segments.seq.load = newseq;
        this._src.inputPosition = this.segments.list[this.segments.seq.load].base;
    };

    this._onSeek = function(event) {

        this._seek(event.data.pos, event.data.sweep);
    };

    this._eof = function() {

        for(var i = 0; i < this._pstats.length; i++) {

            if(this._pstats[i].codec !== undefined) {

                this._src.addFrame(this._pstats[i].codec, null, 0, 0, 0, 0, SBPFrameType.eof, false);
            }
        }
    };

    ////////// TS 디먹싱 관련 ////////
    this._packetStat = function(pid, codec) {

        var i;
        var res = null;

        for(i = 0; i < this._pstats.length; i++) {

            if(this._pstats[i].pid === pid) {
                res = this._pstats[i];
                break;
            }
        }

        if(res == null) {

            var t = this._src.trackOf(codec);
            this._tracks.push(t.key);

            res = { pid: pid, schk: false, sseq: -1, cnt: -1, firstDts: -1, lastDts: -1, lastCts: 0, dtsbase: 0, essize: 0, codec: codec,
                pesbase: 0,
                esdata: codec !== undefined ? new Uint8Array(4096) : null,
                nsdata: codec === SBPCodec.avc ? new Uint8Array(4096) : null,
                broken: true,
                eslen: 0, };

            this._pstats.push(res);
        }

        return res;
    };

    this._tsTime = function(p, offset) {

        return (p[offset] & 0x0E) * 536870912 +  // 1 << 29
            (p[offset + 1] & 0xFF) * 4194304 +    // 1 << 22
            (p[offset + 2] & 0xFE) * 16384 +      // 1 << 14
            (p[offset + 3] & 0xFF) * 128 +        // 1 << 7
            (p[offset + 4] & 0xFE) / 2;
    };

    this._splitFilter = function(stat, sseq, dts, tick) {

        if(!stat.schk) {

            if(stat.sseq === -1 || sseq !== stat.sseq + 1) {

                this.logger.put(SBPLogLevel.stat, SBPLogSection.input, "add split because of stat.sseq=" + stat.sseq + ", sseq=" + sseq);

                this._src.addFrame(stat.codec, null, 0, 0, 0, 0, SBPFrameType.split, this._newPos !== -1);

                // 라이브에 대해서만....
                if(!this._lc.done) {

                    var t = this._src.trackOf(stat.codec);

                    this._lc.correction += dts - (this._lc.ep.val);
                    this._lc.done = true;

                    this.logger.put(SBPLogLevel.stat, SBPLogSection.input, "split correction="+(this._lc.correction / 90000) + " sec by "+stat.codec.track.desc +
                        " from { track=" + (this._lc.ep.track == null ? "none" : this._lc.ep.track.desc) + ", pts="+((this._lc.ep.val-t.stat.firstdts) / 90000)+"}");
                }
            }

            stat.schk = true;
            stat.sseq = sseq;
        }

        if(this._lc.ep.val < (dts + tick)) {

            this._lc.ep.val = dts + tick;
            this._lc.ep.track = stat.codec.track;
        }
    };

    this._adtsOut = function(stat, offset, dts, pts, sseq) {

        var res;
        var hsize = 7, rb;
        var track = this._src.trackOf(SBPCodec.aac);
        if(track == null) return SBPError.implement;

        if(stat.esdata[offset] !== 0xff || (stat.esdata[offset+1] >> 4) !== 0xf) return SBPError.dataBroken;

        if((stat.esdata[offset+1] & 0x1) === 0) hsize = hsize + 2;

        if(track.sampleRate === undefined) {

            // ADTS 헤더 파싱하여 오디오 트랙 정보 설정
            track.sampleBits = 16;
            track.objType = ((stat.esdata[offset+2] & 0xC0) >>> 6) + 1;
            track.sampleRate = ((stat.esdata[offset+2] & 0x3C) >>> 2);
            track.sampleRate = SBPAudio.sampleRate[track.sampleRate];
            track.channels = ((stat.esdata[offset+2] & 0x01) << 2) | ((stat.esdata[offset+3] & 0xC0) >>> 6);

            // AAC 프레임 디코딩은 생략하고, 샘플 레이트가 24000이하면 HE-AAC로 간주한다.
            if(track.sampleRate <= 24000) {

                track.objType = 5;
                track.sampleRate = track.sampleRate * 2;
            }
        }

        rb = ((stat.esdata[offset+3] & 0x03) << 11);
        rb |= (stat.esdata[offset+4] << 3);
        rb |= ((stat.esdata[offset+5] >> 5) & 0x7);

        if(offset + rb > stat.eslen) {

            stat.essublen = stat.eslen - offset;
            return SBPError.success;
        }

        this._splitFilter(stat, sseq, dts, track.tick);

        if((res = this._src.addFrame(SBPCodec.aac, stat.esdata, offset+hsize, offset+rb, dts - this._lc.correction, pts - this._lc.correction, SBPFrameType.key, this._newPos !== -1)) !== SBPError.success) return res;

        stat.essublen = rb;
        return SBPError.success;
    };

    this._mpaOut = function(stat, offset, dts, pts, sseq) {

        var rb;
        var res;

        var track = this._src.trackOf(SBPCodec.mpa);
        if(track == null) return SBPError.implement;

        rb = SBPMpa.parseFrame(stat.esdata, offset, stat.eslen - offset, track);

        this._splitFilter(stat, sseq, dts, track.tick);
        if((res = this._src.addFrame(SBPCodec.mpa, stat.esdata, offset, offset+rb, dts - this._lc.correction, pts - this._lc.correction, SBPFrameType.key, this._newPos !== -1)) !== SBPError.success) return res;

        stat.essublen = rb;
        return SBPError.success;
    };

    this._id3Out = function(stat, offset, dts, pts, sseq) {

        var res;

        var track = this._src.trackOf(SBPCodec.id3);
        if(track == null) return SBPError.implement;

        this._splitFilter(stat, sseq, dts, track.tick);
        if((res = this._src.addFrame(SBPCodec.id3, stat.esdata, offset, stat.eslen, dts - this._lc.correction, pts - this._lc.correction, SBPFrameType.key, this._newPos !== -1)) !== SBPError.success) return res;

        stat.essublen = stat.eslen - offset;
        return SBPError.success;
    };

    // Bit Stream NAL의 시작 패턴 0x00000001, 0x000001 을 찾는다.
    this._nextNalBs = function(buf, offset, size, ps) {

        var i;

        for(i = offset; i < size - 3; i++) {

            if (buf[i] === 0x0 && buf[i+1] === 0x0) {

                if (buf[i+2] === 0x1) {

                    ps.bssize = 3;
                    return i + 3;
                } else if (buf[i+2] === 0x0 && buf[i+3] === 0x1) {

                    ps.bssize = 4;
                    return i + 4;

                } else i++;
            }
        }

        return 0;
    };

    // Network Stream NAL로 재포장하여 버퍼에 기록한다.
    this._putNsNal = function(nsbuf, nsoffset, esbuf, esoffset, nalsize) {

        nsbuf[nsoffset] = 0;
        nsbuf[nsoffset + 1] = 0;
        nsbuf[nsoffset + 2] = 0;
        nsbuf[nsoffset + 3] = 0;

        nsbuf.set([(nalsize >>> 24) & 0xFF, (nalsize >>> 16) & 0xFF, (nalsize >>> 8) & 0xFF, nalsize & 0xFF], nsoffset);
        nsbuf.set(esbuf.subarray(esoffset, esoffset + nalsize), nsoffset + 4);

        return nalsize + 4;
    };

    // Bits Stream NAL -> Network Stream NAL 변환
    this._avcNalOut = function(stat, offset, dts, pts, sseq) {

        var res;
        var i = offset, nslen = 0;
        var ps = { idr:false, naltype: 0, nalsize: 0, bssize: 0, pnoffset: -1, };
        var nsz, np;

        while(i < stat.eslen - offset) {

            i = this._nextNalBs(stat.esdata, i, stat.eslen - i, ps);
            if(i === 0) break;

            if(ps.pnoffset !== -1) {

                ps.naltype = stat.esdata[ps.pnoffset] & 0x1f;
                ps.nalsize = (i - ps.pnoffset - ps.bssize);

                if(ps.naltype !== 6 && ps.naltype !== 9) { // SEI, AU Nal은 스킵

                    if(ps.naltype === 5) ps.idr = true;

                    if(nslen + 4 + ps.nalsize > stat.nsdata.length) {

                        nsz = ((nslen + 4 + ps.nalsize) / 4096 + 1) * 4096;
                        np = new Uint8Array(nsz);
                        np.set(stat.nsdata, 0);

                        stat.nsdata = np;
                    }

                    nslen += this._putNsNal(stat.nsdata, nslen, stat.esdata, ps.pnoffset, ps.nalsize);
                }
            }

            ps.pnoffset = i;
            ps.naltype = stat.esdata[ps.pnoffset] & 0x1f;

            // None IDR, IDR이 나오면 편의상 다음 스캔은 중지한다.
            if(ps.naltype === 1 || ps.naltype === 5) break;
        }

        if(ps.pnoffset === -1) {

            this.logger.put(SBPLogLevel.warning, SBPLogSection.input, "broken avc ES found at dts=" + ((dts - this._lc.correction) / 90000.0).toFixed(3) + " sec");

        } else {

            ps.naltype = stat.esdata[ps.pnoffset] & 0x1f;
            ps.nalsize = (stat.eslen - ps.pnoffset);

            if(ps.naltype !== 6 && ps.naltype !== 9) { // SEI, AU Nal은 스킵

                if(ps.naltype === 5) ps.idr = true;

                if(nslen + 4 + ps.nalsize > stat.nsdata.length) {

                    nsz = ((nslen + 4 + ps.nalsize) / 4096 + 1) * 4096;
                    np = new Uint8Array(nsz);
                    np.set(stat.nsdata, 0);

                    stat.nsdata = np;
                }

                nslen = nslen + this._putNsNal(stat.nsdata, nslen, stat.esdata, ps.pnoffset, ps.nalsize);
            }
        }

        if(nslen > 0) {

            var track = this._src.trackOf(SBPCodec.avc);
            if(track == null) return SBPError.implement;

            this._splitFilter(stat, sseq, dts, track.tick);
            if((res = this._src.addFrame(SBPCodec.avc, stat.nsdata, 0, nslen, dts - this._lc.correction, pts - this._lc.correction, ps.idr ? SBPFrameType.key : SBPFrameType.delta, this._newPos !== -1)) !== SBPError.success) return res;
        }

        stat.essublen = stat.eslen - offset;
        return SBPError.success;
    };

    this._esOut = function(stat, sseq) {

        if(stat.eslen === 0 || stat.broken) return SBPError.success;

        var res, i, pts, dts;
        var track;

        // Timestamp overflow에 대한 처리,
        if(this._hls.live) {

            // 라이브는 점진적 증가로
            pts = dts = stat.lastDts + (stat.dtsbase * 8589934592);

        } else {

            // 비디오는 Seeking에 따른 이동이 있으므로, firstdts 보다 작은 경우에 한 틱 추가해 줌.
            pts = dts = stat.lastDts + (stat.lastDts < stat.firstDts ? 8589934592 : 0);
        }

        pts = pts + stat.lastCts;

        for(i = 0; i < stat.eslen;) {

            switch(stat.codec.id) {

                case SBPCodec.id3.id:
                    if((res = this._id3Out(stat, i, dts, pts, sseq)) !== SBPError.success) return res;
                    break;


                case SBPCodec.mpa.id:
                    if((res = this._mpaOut(stat, i, dts, pts, sseq)) !== SBPError.success) return res;
                    else {

                        track = this._src.trackOf(SBPCodec.mpa);
                        if(track == null) return SBPError.implement;

                        pts = dts = dts + track.tick;
                    }
                    break;

                case SBPCodec.aac.id:
                    if((res = this._adtsOut(stat, i, dts, pts, sseq)) !== SBPError.success) return res;
                    else {

                        track = this._src.trackOf(SBPCodec.aac);
                        if(track == null) return SBPError.implement;

                        pts = dts = dts + track.tick;
                    }
                    break;

                case SBPCodec.avc.id:
                    if((res = this._avcNalOut(stat, i, dts, pts, sseq)) !== SBPError.success) return res;
                    break;

                default:
                    return SBPError.implement;
            }

            i = i + stat.essublen;
        }

        return SBPError.success;
    };

    // MPEG2-TS 파싱 루틴
    this._parseTS = function(sseq, p) {

        var res;
        var i, pi, len;
        var th = {};
        var pstat;
        var pmt = { pid:0, done:false, };

        for(i = 0; i < this._pstats.length; i++) {

            if(this._hls.live && this._pstats[i].sseq !== -1 && sseq !== this._pstats[i].sseq + 1) this._lc.done = false;
            this._pstats[i].schk = false;
        }

        for(i = 0, len = p.length; i < len ; i += 188) {

            if(i + 188 > len) break;
            if(p[i] !== 0x47) return SBPError.dataBroken;

            // TS Header 파싱
            th.pes = ((p[i + 1] >> 6) & 0x1) !== 0;
            th.pid = ((p[i+1] & 0x1f) << 8) + p[i+2];
            th.cnt = (p[i+3] & 0xf);
            th.aff = (p[i+3] >> 4) & 0x3;

            pstat = this._packetStat(th.pid, undefined);

            if(th.aff > 1) {

                // Adaptive Field 건너뛰기

                pi = 5 + p[i + 4];
                if (pi >= 188) continue;

            } else {

                pi = 4;
            }

            // Data Payload가 존재하지 않는 패킷
            if((th.aff & 0x1) === 0) continue;

            // 카운터가 맞지 않을 경우에 대한 처리
            if(pstat.cnt !== -1 && pstat.cnt !== th.cnt) pstat.broken = true;

            // 다음 예상 카운터 계산
            pstat.cnt = th.cnt + 1;
            if(pstat.cnt > 15) pstat.cnt = 0;

            if(th.pid === 0) {

                // PAT
                pi += 11;
                pmt.pid = ((p[i+pi] & 0x1f) << 8) + p[i+pi+1];

            } else if(th.pid === pmt.pid) {

                // PMT
                if(pmt.done) continue;

                var st, tid;

                pi += 11;
                pi += 2 + ((p[i+pi] & 0xf) << 8) + p[i+pi+1];

                while(pi < 188) {

                    st = p[i+pi];
                    pi++;

                    tid = ((p[i+pi] & 0x1f) << 8) + p[i+pi+1];
                    pi += 2;

                    if(p[i+pi] !== 0xf0) break;
                    pi++;

                    switch(st) {

                        case 21: // private

                            if(p[i+pi] >= 15) {

                                // check ID3 Timed Meta Data
                                if(p[i+pi+1] === 38 && p[i+pi+3] === 0xff && p[i+pi+4] === 0xff &&
                                    p[i+pi+5] === 0x49 && p[i+pi+6] === 0x44 && p[i+pi+7] === 0x33) {

                                    pstat = this._packetStat(tid, SBPCodec.id3);
                                }
                            }
                            break;

                        case 3:
                        case 4: // MP3
                            pstat = this._packetStat(tid, SBPCodec.mpa);
                            break;

                        case 15: // AAC ADTS
                            pstat = this._packetStat(tid, SBPCodec.aac);
                            break;

                        case 27: // AVC
                            pstat = this._packetStat(tid, SBPCodec.avc);
                            break;
                    }

                    pi += p[i+pi] + 1;
                }

                pmt.done = true;

            } else if(pstat.codec !== undefined) {

                if(th.pes) {

                    var ph = {};

                    pstat.pesbase = i;
                    pi += 4;

                    ph.size = (p[i+pi] << 8) + p[i+pi+1];
                    pi += 2;

                    ph.offset = pi;
                    pi++;

                    ph.pdi = p[i+pi] >> 6;
                    pi++;

                    ph.hsize = p[i+pi];
                    pi++;

                    if((ph.pdi & 0x02) !== 0) {

                        ph.dts = this._tsTime(p, i + pi);
                        ph.cts = 0;
                        pi += 5;
                        ph.hsize -= 5;
                    }

                    if((ph.pdi & 0x01) !== 0) {

                        var pts = ph.dts;
                        ph.dts = this._tsTime(p, i + pi);
                        ph.cts = pts - ph.dts;

                        pi += 5;
                        ph.hsize -= 5;
                    }

                    pi += ph.hsize;

                    if(this._hls.live && pstat.lastDts !== -1 && ph.dts < pstat.lastDts) ph.dtsbase++;

                    if(ph.pdi === 0x0 || ph.dts === pstat.lastDts) {

                        if(ph.size > 0) {

                            pstat.essize += (ph.size - (pi - ph.offset));

                        } else {

                            pstat.essize = 0;
                        }

                        pstat.broken = false;

                    } else {

                        if((res = this._esOut(pstat, sseq)) !== SBPError.success) return res;

                        if(ph.size > 0) {

                            pstat.essize = ph.size - (pi - ph.offset);

                        } else {

                            pstat.essize = 0;
                        }

                        pstat.lastDts = ph.dts;
                        if(pstat.firstDts === -1) pstat.firstDts = ph.dts;

                        pstat.lastCts = ph.cts;
                        pstat.eslen = 0;
                        pstat.broken = false;
                    }
                }

                if(pi < 188) {

                    var remain  = 188 - pi;

                    if(pstat.essize > 0 && pstat.essize - pstat.eslen < remain) remain = pstat.essize - pstat.eslen;

                    if(remain > 0) {

                        if(pstat.eslen + remain > pstat.esdata.length) {

                            var nsz = ((pstat.eslen + remain) / 4096 + 1) * 4096;

                            var np = new Uint8Array(nsz);
                            np.set(pstat.esdata, 0);

                            pstat.esdata = np;
                        }

                        pstat.esdata.set(p.subarray(i + pi, i + pi + remain), pstat.eslen);
                        pstat.eslen += remain;
                    }
                }
            }
        }

        for(i = 0; i < this._pstats.length; i++) {

            if(this._pstats[i].codec === undefined) continue;
            if((res = this._esOut(this._pstats[i], sseq)) !== SBPError.success) return res;

            // 세그먼트 먹싱 상태 초기화 (중복 빌드 방지)
            this._pstats[i].cnt = -1; // 매 세그먼트마다 카운터는 초기화 해준다. 세그먼트 독립성 보장
            this._pstats[i].eslen = 0;
            this._pstats[i].essize = 0;
        }

        if(this._src.isAcceptableNextSegment(this._tracks)) return SBPError.success;
        else return SBPError.wait;
    };
}

SBPHlsSegment.prototype.start = function(url) {

    this._url = url;
    this._target = SBPHlsTarget.manifest;
    this._duration = 0;

    this._pstats = [];
    this._tracks = [];
    this._stopped = false;

    this._lc = { ep: 0, correction: 0, done: true, };

    this.segments = {

        avedur : undefined,

        seq : {
            last: undefined,
            load: -1,
        },

        list: [],
    };

    // HTTP 로더 설정
    this.loader = new SBPHttpDownloader(this._onDownloadSuccess.bind(this), this._onDownloadError.bind(this), this._onDownloadError.bind(this), this.config.hlsHttpTimeout);

    // 매니패스트 로딩 이벤트 생성 및 실행
    this.oml = new SBPEventHandler(SBPEvent.inputUpdate, this._onUpdate.bind(this));

    // 세그먼트 로딩 이벤트 생성 (실행은 매니패스트 첫번째 로딩 시)
    this.osl = new SBPEventHandler(SBPEvent.segmentLoad, this._onSegmentLoad.bind(this));

    this.oml.dispatch();
};

SBPHlsSegment.prototype.destroy = function() {

    this.stop();

    if(this.cb.error != null) {

        this.cb.error.destroy();
        this.cb.error = null;
    }

    if(this.cb.endlist != null) {

        this.cb.endlist.destroy();
        this.cb.endlist = null;
    }

    this._src = null;
    this.config = null;
    this.logger = null;
};

SBPHlsSegment.prototype.stop = function() {

    if(this.uth) {
        window.clearTimeout(this.uth);
        this.uth = null;
    }

    if(this.loader != null) {

        this.loader.destroy();
        this.loader = null;
    }

    if(this.osl != null) {

        this.osl.destroy();
        this.osl = null;
    }

    if(this.oml != null) {

        this.oml.destroy();
        this.oml = null;
    }

    this.segments.list = null;
    this._pstats = null;
    this._tracks = null;
    this._url = null;
};

SBPHlsSegment.prototype.addEventListener = function(event, listener) {

    if(event === SBPEvent.streamInputError) {

        if(this.cb.error) this.cb.error.addListener(listener);
        else this.cb.error = new SBPEventHandler(event,listener);

    } else if(event === SBPEvent.inputUpdateEnd) {

        if(this.cb.endlist) this.cb.endlist.addListener(listener);
        else this.cb.endlist = new SBPEventHandler(event,listener);
    }
};

function SBPHls(config, logger) {

    this.config = config;
    this.logger = logger;

    this.live = true;
    this.duration = 0;

    this.loader = null;
    this.streams = null;
    this._segment = null;
    this._adapt = -1;
    this._newPos = -1;

    Object.defineProperty(this, 'src', {

        set: function(src) {

            this._src = src;
        },
    });


    Object.defineProperty(this, 'adapt', {

        set: function(adapt) {

            this._adapt = adapt;
        },
    });

    Object.defineProperty(this, 'newPos', {

        set: function(pos) {

            this._newPos = pos;
        },
    });

    // 마스터 M3U8 매니패스트 파싱
    this._parseMasterManifest = function(txt, baseUrl) {

        var regexp = /#EXT-X-STREAM-INF:([^\n\r]*(BAND)WIDTH=(\d+))?([^\n\r]*(CODECS)="(.*)",)?([^\n\r]*(RES)OLUTION=(\d+)x(\d+))?([^\n\r]*(NAME)="(.*)")?[^\n\r]*[\r\n]+([^\r\n]+)/g;

        while((result = regexp.exec(txt)) !== null) {

            var stream = {

                name: "",
                bandwidth: 0,
                width: 0,
                height: 0,
                url : ""
            };

            result.shift();
            result = result.filter(function(n){ return (n !== undefined);});

            stream.url = SBPUtil.resolveUrl(result.pop(), baseUrl);

            while(result.length > 0) {

                switch(result.shift()) {

                    case 'RES':
                        stream.width = parseInt(result.shift());
                        stream.height = parseInt(result.shift());
                        break;

                    case 'BAND':
                        stream.bandwidth = parseInt(result.shift());
                        break;
                    case 'NAME':
                        stream.name = result.shift();
                        break;

                    default:
                        break;
                }
            }

            this._addSegment(stream.name, stream.bandwidth, stream.width, stream.height, stream.url);
        }

        if(!this.streams || !this.streams.length) {

            if(this.cb.error) this.cb.error.dispatch({error: SBPError.unknownData, url:this.url});
            return;
        }

        this._startSegment(this._adapt === -1 ? 0 : this._adapt);
    };

    this._addSegment = function(name, bw, w, h, url) {

            if(this.streams == null) this.streams = [];

            var seg = {

                 active: false,
                 name: name,
                 bandwidth : bw,
                 width: w,
                 height: h,
                 url : url
            };

            this.streams.push(seg);
    };

    this._startSegment = function(adapt) {

        if(!this.streams || this.streams.length <= adapt) return;

        if(this._segment) this._segment.destroy();

        this._segment = new SBPHlsSegment(this, this.streams[adapt]);
        this._segment.src = this._src;
        this._segment.newPos = this._newPos;

        this._segment.addEventListener(SBPEvent.streamInputError, this._onSegmentError.bind(this));
        this._segment.addEventListener(SBPEvent.inputUpdateEnd, this._onEndlist.bind(this));

        if(this._adapt !== -1) this.streams[this._adapt].active = false;

        this._adapt = adapt;
        this._segment.start(this.streams[adapt].url);
    };

    this._onDownloadSuccess = function(event) {

        var txt = event.currentTarget.responseText, url = event.currentTarget.responseURL;

        if(url !== undefined) {

            // redirection일 경우에 대해, 매니패스트 URL 갱신
            // * 일부 브라우저에서는 지원되지 않음(url == undefined).
            this.url = url;
        }

        if(txt.indexOf('#EXTM3U') === -1) {

            if(this.cb.error) this.cb.error.dispatch({error: SBPError.unknownData, url:this.url});
        }

        if(txt.indexOf('#EXTINF:') === -1) {

            this._parseMasterManifest(txt, url);

        } else {

            this._addSegment("", 0, 0, 0, url);
            this._startSegment(0);
        }
    };

    this._onDownloadError = function() {

        this._onError(SBPError.get, this.url);
    };

    this._onSegmentError = function(event) {

        console.log("event.data.url="+event.data.url+", adapt="+this._adapt+"/"+this.streams.length);

        if(this._adapt < this.streams.length - 1) this._startSegment(this._adapt + 1);
        else this._onError(SBPError.get, event.data.url);
    };

    this._onEndlist = function(event) {

        this.live = false;
        if(this.duration < event.data) this._src.duration = this.duration = event.data;
    };

    this._onError = function(err, url)
    {
        if(this.oie) this.oie.dispatch({error: err, url: url});
    };
}

SBPHls.prototype.destroy = function() {

    this.stop();

    if(this.oie != null) {

        this.oie.destroy();
        this.oie = null;
    }

    this._src = null;
    this.url = null;
    this.config = null;
    this.logger = null;
};

// 리스너 연결
SBPHls.prototype.addEventListener = function(event, listener) {

    if(event === SBPEvent.inputError) {

        if(this.oie) this.oie.addListener(listener);
        else this.oie = new SBPEventHandler(event,listener);
    } 
};

// 스트림 수신을 시작한다.
SBPHls.prototype.start = function(url) {

    if(this.loader) throw SBPError.condition;

    this.url = url;

    this.loader = new SBPHttpDownloader(this._onDownloadSuccess.bind(this), this._onDownloadError.bind(this), this._onDownloadError.bind(this), this.config.hlsHttpTimeout);
    this.loader.load(this.url, false, this.config.hlsHttpRetry - 1, this.config.hlsHttpRetryInterval);
};

// 스트림 수신을 중지한다.
SBPHls.prototype.stop = function() {

    if(this.loader != null) {

        this.loader.destroy();
        this.loader = null;
    }

    if(this._segment != null) {

        this._segment.destroy();
        this._segment = null;
    }

    this.streams = null;
    this.live = true;
    this.duration = 0;
    this._adapt = -1;
};

SBPHls.prototype.switch = function(adapt) {


};