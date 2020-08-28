
var SBPEvent = {

    inputUpdate : "SBPEvent/input/update",      // 입력 스트림의 구성 업데이트가 필요한 경우(live input).

    // for HTTP Streaming
    segmentLoad : "SBPEvent/input/segment/load",    // 입력 스트림의 세그먼트 로딩이 필요한 경우
    streamInputError: "SBEvent/stream/input/error",    //

    inputError : "SBPEvent/input/none",         // 입력 스트림에 문제가 발생했음.
    inputUpdateEnd : "SBPEvent/input/end",      // 더이상 업데이트할 세그먼트 리스트가 없음(VOD)

    sbResume : "SBPEvent/engine/resume",        // 입력 재개를 요청
    sbReady : "SBPEvent/engine/ready",          // 재생 시작 가능
    sbSeek : "SBPEvent/engine/seek",            // 새로운 입력 위치로 변경할 것을 요청
    sbRestart : "SBPEvent/engine/restart",      // 재생 재시작
    sbMetaOut : "SBPEvent/engine/metaOut",      // 메타 데이터 출력
    sbTextOut : "SBPEvent/engine/textOut",      // 텍스트 출력

};

function SBPEventHandler(event, listener) {

    this.listener = [listener, ];
    this.event = event;

    this.obj = document.createEvent('Event');
    this.obj.initEvent(this.event, true, true);

    document.addEventListener(this.event, listener);
}

SBPEventHandler.prototype.addListener = function(listener) {

    document.addEventListener(this.event, listener);
    this.listener.push(listener);
};

SBPEventHandler.prototype.dispatch = function(data) {

    this.obj.data = data;
    document.dispatchEvent(this.obj);
};

SBPEventHandler.prototype.destroy = function() {

    var i;

    for(i = 0; i < this.listener.length; i++) {

        document.removeEventListener(this.event, this.listener[i]);
    }

    this.obj = null;
    this.event = null;
    this.listener = null;
};
