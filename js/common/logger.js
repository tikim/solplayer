
var SBPLogLevel = {

    none: 0,
    error : 1,
    warning : 2,
    stat : 3,
    all : 255,
};

var SBPLogSection = {

    none: 0,
    input: 1,
    engine: 2,
    playback: 4,
    all: 255,
};

function SBPLogger(level, section) {

    this.level = level;
    this.section = section;
}

SBPLogger.prototype.put = function(level, section, str) {

    if(level <= this.level && (this.section & section) !== 0) {

        console.log(str);
    }
};