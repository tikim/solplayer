
function SBPUtil() {

}

    // 절대 경로 URL 빌드 함수
SBPUtil.resolveUrl = function(url, baseUrl) {

    var doc = document,
        oldBase = doc.getElementsByTagName('base')[0],
        oldHref = oldBase && oldBase.href,
        docHead = doc.head || doc.getElementsByTagName('head')[0],
        ourBase = oldBase || docHead.appendChild(doc.createElement('base')),
        resolver = doc.createElement('a'),
        resolvedUrl;

    ourBase.href = baseUrl;
    resolver.href = url;
    resolvedUrl = resolver.href; // browser magic at work here

    if (oldBase) {
        oldBase.href = oldHref;
    }
    else {
        docHead.removeChild(ourBase);
    }

    return resolvedUrl;
};

SBPUtil.toHexString = function(data, offset, size, token) {

    var res = "";

    for(;size > 0; size--, offset++) {

        res += (data[offset] < 0x10 ? "0" : "") + (data[offset] & 0xff).toString(16) + token;
    }

    return res;
};

SBPUtil.saveChunk = function(data, start, end, fname) {

    // 본 함수는 테스트 검증 용이며,
    // https://github.com/eligrey/FileSaver.js 프로젝트를 사용한다.
    // FileSaver.js는
    //
    //      https://cdn.rawgit.com/eligrey/FileSaver.js/e9d941381475b5df8b7d7691013401e171014e89/FileSaver.min.js
    //
    // 에서 다운로드하거나 경로 그대로 사용할 수 있다.
    // 사용하기 위해서는 스크립트를 HTML에 추가해 주어야 한다(아래 코드 삽입).
    //
    //      <script type="text/javascript" src="https://cdn.rawgit.com/eligrey/FileSaver.js/e9d941381475b5df8b7d7691013401e171014e89/FileSaver.min.js"></script>

    try {

        saveAs(new Blob([data.subarray(start, end)], {type: "application/octet-stream"}), fname);

    } catch(e) {

    }
};

SBPUtil.memdup = function(data, start, end) {

    return new Uint8Array(data.subarray(start, end));
};
