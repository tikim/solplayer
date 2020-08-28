
function SBPBitReader(data, offset, size) {

    this.bitsLeft = 8;
    this.p = data;
    this.so = offset;
    this.co = 0;
    this.size = size;
}

SBPBitReader.prototype.eof = function () {

    return this.bitsLeft === 0 && this.size === 0;
};

SBPBitReader.prototype.readU1 = function() {

    if(this.eof()) return 0;

    this.bitsLeft = this.bitsLeft - 1;
    var res = (this.p[this.so + this.co] >> this.bitsLeft) & 0x1;

    if(this.bitsLeft === 0) {

        this.bitsLeft = 8;
        this.co = this.co + 1;
        this.size = this.size - 1;

        if(this.co > 1 && this.p[this.so + this.co] === 0x3 && this.p[this.so + this.co - 1] === 0x0 && this.p[this.so + this.co - 2] === 0x0) {

            this.co = this.co + 1;
            this.size = this.size - 1;
        }
    }

    return res;
};

SBPBitReader.prototype.skip = function(n) {

    var i;

    for(i = 0; i < n; i++) {

        if(this.eof()) return;

        this.bitsLeft = this.bitsLeft - 1;

        if(this.bitsLeft === 0) {

            this.bitsLeft = 8;
            this.co = this.co + 1;
            this.size = this.size - 1;

            if(this.co > 1 && this.p[this.so + this.co] === 0x3 && this.p[this.so + this.co - 1] === 0x0 && this.p[this.so + this.co - 2] === 0x0) {

                this.co = this.co + 1;
                this.size = this.size - 1;
            }
        }
    }
};

SBPBitReader.prototype.readU = function(n) {

    var i, res = 0;

    for(i = 0; i < n; i++) {

        res |= (this.readU1() << (n - i - 1));
    }

    return res;
};

SBPBitReader.prototype.skipUE = function() {

    var i = 0;

    while(!this.eof() && this.readU1() === 0 && i < 32) i++;
    this.skip(i);
};

SBPBitReader.prototype.readUE = function() {

    var i = 0;

    while(!this.eof() && this.readU1() === 0 && i < 32) i++;

    var res = this.readU(i);
    res = res + (1 << i) - 1;

    return res;
};

SBPBitReader.prototype.readSE = function() {

    var res = this.readUE();

    if(res & 0x01) res = (res + 1) / 2;
    else res = 0 - (res / 2);

    return res;
};
