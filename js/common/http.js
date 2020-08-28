
function SBPHttpDownloader(onSuccess, onError, onTimeout, timeout) {

    this._load = function() {

        this.loader.open('GET', this.url, true);
        this.loader.responseType = this.binary ? "arraybuffer" : "";
        this.loader.send();
    };

    this._onLoadSuccess = function(event) {

        if(Math.floor(event.currentTarget.status / 100) === 2) {

            if (this.to) {

                window.clearTimeout(this.to);
                this.to = null;
            }

            this.stats.tdone = new Date();
            this.stats.mtime = new Date(event.currentTarget.getResponseHeader('Last-Modified'));
            this.onSuccess(event, this.stats);

        } else {

            this._onLoadError(event);
        }
    };

    this._onLoadError = function(event) {

        if(!this.stats.aborted && this.loader.readyState !== 4 && this.stats.retry < this.mr) {

            window.setTimeout(this._load.bind(this), this.ri);
            this.ri = Math.min(2 * this.ri, 10000); // 최대 10초까지 재시도 Interval 증가토록
            this.stats.retry++;

        } else {

            if(this.to) {
                window.clearTimeout(this.to);
                this.to = null;
            }

            if(!this.stats.aborted) this.onError(event);
        }
    };

    this._onLoadTimeout = function(event) {

        this.abort();
        this.onTimeout(event, this.stats);
    };

    this.onSuccess = onSuccess;
    this.onError = onError;
    this.onTimeout = onTimeout;
    this.timeout = timeout;
    this.loader = new XMLHttpRequest();
    this.loader.onload = this._onLoadSuccess.bind(this);
    this.loader.onerror = this._onLoadError.bind(this);
    this.stats = {};
}

SBPHttpDownloader.prototype.destroy = function() {

    this.abort();

    this.loader = null;
    this.timeout = null;
};

SBPHttpDownloader.prototype.abort = function() {

    this.stats.aborted = true;

    if(this.loader &&this.loader.readyState !== 4) this.loader.abort();
    if(this.to) {
        window.clearTimeout(this.to);
        this.to = null;
    }
};

SBPHttpDownloader.prototype.load = function(url, binary, maxRetry, retryInterval) {

    this.abort();

    this.url = url;
    this.mr = maxRetry;
    this.ri = retryInterval;
    this.stats.aborted = false;
    this.binary = binary;

    this.to = window.setTimeout(this._onLoadTimeout.bind(this), this.timeout);
    this.stats = { treqeust: new Date(), retry:0};

    this._load();
};

