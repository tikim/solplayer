
var SBPInputType = {

    unknown : "SBPInputType/unknown",
    hls : "SBPInputType/hls",
    wrtp : "SBPInputType/wrtp",
};

var SBPSwitchMode = {

    active: true,
    passive: false,
};

function SBPlayer(video, cfg) {

    if(cfg === undefined) cfg = {};

    this.ev = { meta: null, text: null, };
    this._needRestart = false;
    this._needSwitch = -1;
    this._switchPos = -1;
    this._afterSwitch = 0;
    this._switchMode = SBPSwitchMode.passive;

    // 프로퍼티
    Object.defineProperty(this, 'status', {

        get: function() {

            if(this.source) return this.source.status;
            return null;
        },
    });

    Object.defineProperty(this, 'streams', {

        get: function() {

            if(this.input) return this.input.streams;
            return null;
        },
    });

    Object.defineProperty(this, 'config', {

        set: function(cfg) {

            for(var prop in cfg) this._config[prop] = cfg[prop];
            this._applyDP();
        },
    });

    Object.defineProperty(this, 'switchMode', {

        set: function(mode) {

            this._switchMode = mode;
        },
    });

    this._close = function () {

        if(this.input != null) this.input.stop();
        if(this.source != null) this.source.stop();

        if(this.ms != null) {

            this.ms.removeEventListener('sourceopen',  this.onmso);
            this.ms.removeEventListener('sourceended', this.onmse);
            this.ms.removeEventListener('sourceclose', this.onmsc);

            if(this.video) window.URL.revokeObjectURL(this.video.src);
            this.ms = null;
        }

        if(this.input != null && this.input !== this._config.input) {

            this.input.destroy();
            this.input = null;
        }

        if(this.source != null) {

            this.source.destroy();
            this.source = null;
        }
    };

    this._applyDP = function() {

        if(this._config.delay === SBPDelay.extreme) {

            this._config.hlsStartOffset = -1;
            this._config.sbSegmentDuration = 0.6;
            this._config.sbStartSegmentCount = 1;

        } else if(this._config.delay === SBPDelay.normal) {

            this._config.hlsStartOffset = 0;
            this._config.sbSegmentDuration = 1;
            this._config.sbStartSegmentCount = 2;

        } else if(this._config.delay === SBPDelay.minimum) {

            this._config.hlsStartOffset = -2;
            this._config.sbSegmentDuration = 0.6;
            this._config.sbStartSegmentCount = 2;
        }
    };

    // HTML5 비디오 element이 SourceBuffer(MSE)로부터 데이터를 받을 준비가 될 때 호출된다.
    // 이 시점은 재생 시작과 별개로, HTML5 비디오 element와 미디어 소스(MSE)와 연결된 후 prepare() 단계에서 호출되는 것으로 생각하면 된다.
    this._onMediaSourceOpen = function() {

        this.logger.put(SBPLogLevel.stat, SBPLogSection.playback, "_onMediaSourceOpen");

        // 입력 수신을 시작한다. [#재생 시작점]
        this.input.start(this.url);
    };

    // MediaSource.endOfStream() 함수 호출 시 호출된다.
    this._onMediaSourceEnded = function() {

        this.logger.put(SBPLogLevel.stat, SBPLogSection.playback, "_onMediaSourceEnded");
        this._close();

        if(this._needRestart || this._needSwitch !== -1) this.open(this.url);
    };

    // HTML5 비디오 element와 미디어 소스(MSE)가 연결 해제될 경우 호출된다.
    this._onMediaSourceClose = function() {

        this.logger.put(SBPLogLevel.stat, SBPLogSection.playback, "_onMediaSourceClose");
        this._close();
    };

    // 입력 수신에 문제가 발생했을 경우 호출된다. SPEvent.inputError
    this._onInputError = function(event) {

        this.logger.put(SBPLogLevel.error, SBPLogSection.input, "SBP Error: code=" + event.data.error + (event.data.error === SBPError.get ?  ", target=" + event.data.url : ""));
        if(this.source) this.source.endOfStream();
    };
    
    // SourceBuffer 준비 완료
    this._onSBReady = function() {

        this.logger.put(SBPLogLevel.stat, SBPLogSection.playback, "stream ready" + (this._config.autoplay === true ? ", then start play(autoplay)" : ""));

        if(this._switchPos !== -1) {
            this.video.currentTime = this._switchPos;
            this._switchPos = -1;
        }
        if(this._afterSwitch) {

            if(this._afterSwitch === 1) this.video.play();
            this._afterSwitch = 0;

        } else if(this._config.autoplay) this.video.play();

        if(this.ev.list) this.ev.list.dispatch();
    };

    // 재시작 요청
    this._onSBRestart = function() {

        this._needRestart = true;
        this._afterSwitch = 1;
        this.source.endOfStream();
    };

    // 메타 데이터 출력
    this._onSBMetaOut = function(event) {

        if(this.ev.meta) this.ev.meta.dispatch(event.data);
    };

    // 텍스트 데이터 출력
    this._onSBTextOut = function(event) {

    };

    var configDefault = {
        logLevel : SBPLogLevel.error,             // 로그 레벨
        logSection : SBPLogSection.playback,        // 로그 대상 비트 플래그
        input : SBPInputType.unknown,               // 입력 객체 혹은 타입

        // for hls
        hlsHttpTimeout : 10000,     // HTTP 요청 타임아웃(기본값 10초)
        hlsHttpRetry : 2,           // HTTP 요청 실패 시 재시도 횟수
        hlsHttpRetryInterval : 500, // HTTP 요청 실패 시 재시도 최소 간격
        hlsStartOffset : -3,        // hls 라이브 스트리밍의 시작 세그먼트 위치 (마이너스 값이면 현재 리스트에서 마지막 N번째부터,
                                    // 그렇지 않으면 해당 시퀀스 넘버의 세그먼트부터(존재 하지 않으면 리스트에 첫번째 부터),
                                    // VOD 스트리밍일 경우에는 무시됨.

        // for SBSourceBuffer
        sbSegmentDuration : 0.5,    // MSE 미디어 소스 버퍼로 내보낼 세그먼트 먹싱 단위(초)
        sbStartSegmentCount : 1,    // MSE 미디어 소스 버퍼와 연동일 시작할 최소 세그먼트 수(먹싱된).
        sbBufferRange : { front : 0, back : 0, }, // 버퍼링 크기(초) (front=현재 커서에서 앞부분의 크기, back=현재 커서에서 뒷부분의 크기, 0이면 무제한).
        sbLiveResume : "continue",  // 라이브 Paused 상태에서 재생을 재게할 경우 수행할 방식 ("continue"=현재 상태에서 그대로 진행, "restart"=재시작)

        // video
        autoplay : true,

        // for live
        delay : SBPDelay.normal,

    };

    for (var prop in configDefault) {
        if (prop in cfg) { continue; }
        cfg[prop] = configDefault[prop];
    }

    this.logger = new SBPLogger(cfg.logLevel, cfg.logSection);
    this._config = cfg;
    this.video = video;
    if(this.video.autoplay) this.video.autoplay = false;

    // MSE 미디어 소스 리스너 설정
    this.onmso = this._onMediaSourceOpen.bind(this);
    this.onmse = this._onMediaSourceEnded.bind(this);
    this.onmsc = this._onMediaSourceClose.bind(this);

    // SBPSource 리스너 설정
    this.sbevent = {

        ready: this._onSBReady.bind(this),
        meta: this._onSBMetaOut.bind(this),
        text: this._onSBTextOut.bind(this),
        restart: this._onSBRestart.bind(this),
    };
}

SBPlayer.isSupported = function() {

    return (window.MediaSource && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'));
};

SBPlayer.prototype.open = function(url) {

    this._close();

    this.url = url;
    this.input = null;

    // 입력 핸들러를 생성한다.
    if(this._config.input === SBPInputType.unknown) {

        //TODO: 스트림 타입이 지정되지 않은 경우, 매니패스트로 간주하고 매니패스트 포맷 체크하여 스트림 타입을 알아낸다.
        return SBPError.support;

    } else if (this._config.input === SBPInputType.hls) {

        // WebSocket RTP Stream 일 경우

        this.input = new SBPHls(this._config, this.logger);

    } else if (this._config.input === SBPInputType.wrtp) {

        //TODO: WebSocket RTP Stream 일 경우
        return SBPError.support;

    } else {

        this.input = this._config.input;
    }

    this.input.addEventListener(SBPEvent.inputError, this._onInputError.bind(this));

    // SBP 소스 버퍼를 생성하고 입력 핸들러와 연결한다.
    this.source = new SBPSource(this.video, this._config, this.logger);
    this.source.newPos = this._switchPos;
    this.input.src = this.source;
    this.input.adapt = this._needSwitch;
    this.input.newPos = this._switchPos;

    this.source.addEventListener(SBPEvent.sbReady, this.sbevent.ready);
    this.source.addEventListener(SBPEvent.sbRestart, this.sbevent.restart);
    this.source.addEventListener(SBPEvent.sbMetaOut, this.sbevent.meta);
    this.source.addEventListener(SBPEvent.sbTextOut, this.sbevent.text);

    // 1. 미디어 소스(MSE)를 생성
    this.ms = new MediaSource();
    this.source.ms = this.ms;

    // 2. 미디어 소스(MSE)의 Event를 셋팅한 후
    this.ms.addEventListener('sourceopen', this.onmso);
    this.ms.addEventListener('sourceended', this.onmse);
    this.ms.addEventListener('sourceclose', this.onmsc);

    // 3. HTML5 비디오 element와 미디어 소스(MSE)를 연결한다.
    this.video.src = URL.createObjectURL(this.ms);

    this._needRestart = false;
    this._needSwitch = -1;

    // 이후에는 'sourceopen' 이벤트 발생 후 입력 핸들러를 start() 하면 재생이 진행되게 된다.
    return SBPError.success;
};

/*
    재생을 중지한다.
 */
SBPlayer.prototype.close = function() {

    this._needRestart = false;
    this._needSwitch = -1;
    this._switchPos = -1;
    this._close();
};

SBPlayer.prototype.switch = function(adapt) {

    this._needSwitch = adapt;

    if(this.source.isLive()) this._switchPos = -1;
    else this._switchPos = this.source.status.mse.position;

    this._afterSwitch = this.source.paused ? 2 : 1;
    this.source.endOfStream();
};

SBPlayer.nameOfStream = function(stream) {

    if(stream.name) return stream.name;
    if(stream.height > 0) return stream.height + "p";
    return "unnamed";
};

SBPlayer.prototype.addEventListener = function(event, listener) {

   if(event === "onMeta") {

        this.ev.meta = new SBPEventHandler(event, listener);

    } else if(event === "onText") {

        this.ev.text = new SBPEventHandler(event, listener);

    } else if(event === "onAdaptiveList") {

       this.ev.list = new SBPEventHandler(event, listener);
   }
};
