const Cairo = imports.cairo;

const GLib = imports.gi.GLib;

const ModulePart = imports.modules.ModulePart;

function process(number){
    return number > 0 && !isNaN(number) && isFinite(number);
}

function Base(){
    this.init.apply(this, arguments);
}

Base.prototype = {
    init: function(canvas){
        this.canvas = canvas;
    },

    begin: function(){
        this.ctx = this.canvas.get_context();
        this.w = this.canvas.get_width();
        this.h = this.canvas.get_height();
    },

    setColor: function(color){
        this.lastColor = color;
        this.ctx.setSourceRGB(color[0], color[1], color[2]);
    },

    setAlpha: function(alpha){
        this.ctx.setSourceRGBA(this.lastColor[0], this.lastColor[1], this.lastColor[2], alpha);
    }
};

function Overview(){
    this.init.apply(this, arguments);
}

Overview.prototype = {
    __proto__: Base.prototype,

    xScale: .5,
    yScale: .5,

    init: function(canvas, modules, settings){
        Base.prototype.init.call(this, canvas);

        this.settings = settings;
        this.modules = {};

        for(let module in modules){
            this[module] = modules[module].dataProvider;
            this.modules[module] = modules[module];
        }
    },

    draw: function(){
        this.begin();

        if(this.settings.thermal){
            this.next("thermal", "thermal");
            this.center((this.thermal.data[0] - this.thermal.min) / (this.thermal.max - this.thermal.min));
        }

        if(this.settings.disk){
            this.next("disk", "write");
            this.small(this.disk.data.write / this.disk.max, true, false);
            this.setColor("disk", "read");
            this.small(this.disk.data.read / this.disk.max, false, false);
        }

        if(this.settings.network){
            if(!this.smallMerged)
                this.next("network", "up");
            else
                this.setColor("network", "up");
            this.small(this.network.data.up / this.network.max, true, true);
            this.setColor("network", "down");
            this.small(this.network.data.down / this.network.max, false, true);
        }

        if(this.settings.cpu){
            for(let i = 0; i < this.cpu.count; ++i){
                this.next("cpu", "core" + (i % 4 + 1));
                this.normal(this.cpu.data.user[i], true);
                this.setAlpha(.75);
                this.normal(this.cpu.data.system[i], true);
            }
        }

        if(this.settings.mem){
            this.next("mem", "mem");
            this.normal(this.mem.data.usedup / this.mem.data.total, false);
            this.setAlpha(.75);
            this.normal(this.mem.data.cached / this.mem.data.total, false);
            this.setAlpha(.5);
            this.normal(this.mem.data.buffer / this.mem.data.total, false);

            this.next("mem", "swap");
            this.normal(this.swap.data.used / this.swap.data.total, false);
        }
    },

    begin: function(){
        Base.prototype.begin.call(this);

        let count = {
            center: 0,
            small: 0,
            normal: 0
        };

        if(this.settings.thermal)
            count.center++;
        if(this.settings.disk)
            count.small++;
        if(this.settings.network)
            count.small++;
        if(this.settings.cpu)
            count.normal += this.cpu.count;
        if(this.settings.mem)
            count.normal += 2;

        if(this.smallMerged && count.small)
            count.small = 1;
        let n = count.center + count.small + count.normal;

        this.dr = Math.min(this.w / n * this.xScale, this.h / n * this.yScale);
        this.r = -this.dr / 2;
        this.ctx.setLineWidth(this.dr);
    },

    next: function(module, colorName){
        this.a = this.startA;
        this.r += this.dr;

        this.setColor(module, colorName);
    },

    setColor: function(module, colorName){
        Base.prototype.setColor.call(this, this.modules[module].color[colorName]);
    }
};


function PieOverview(){
    this.init.apply(this, arguments);
}

PieOverview.prototype = {
    __proto__: Overview.prototype,

    startA: -Math.PI / 2,
    smallMerged: true,

    normal: function(angle, dir){
        if(!process(angle)) return;

        angle *= Math.PI * 2;
        if(dir)
            this.ctx.arc(this.w / 2, this.h / 2, this.r, this.a, this.a += angle);
        else
            this.ctx.arcNegative(this.w / 2, this.h / 2, this.r, this.a, this.a -= angle);
        this.ctx.stroke();
    },

    small: function(angle, dir, side){
        if(!process(angle)) return;

        var a = -Math.PI;
        if(side){
            a = 0;
            dir = !dir;
        }
        angle *= Math.PI / 2;

        if(dir)
            this.ctx.arc(this.w / 2, this.h / 2, this.r, a, a + angle);
        else
            this.ctx.arcNegative(this.w / 2, this.h / 2, this.r, a, a - angle);
        this.ctx.stroke();
    },

    center: function(radius){
        if(!process(radius)) return;

        this.ctx.arc(this.w / 2, this.h / 2, radius * this.dr, 0, Math.PI * 2);
        this.ctx.fill();
    }
};

function ArcOverview(){
    this.init.apply(this, arguments);
}

ArcOverview.prototype = {
    __proto__: Overview.prototype,

    startA: 0,
    yScale: 1,

    normal: function(angle){
        if(!process(angle))
            return;

        angle *= Math.PI / 2;
        if(this.a === 0){
            this.a = angle;
            this.ctx.arc(this.w / 2, this.h, this.r, -this.a - Math.PI / 2, this.a - Math.PI / 2);
        } else {
            this.ctx.arc(this.w / 2, this.h, this.r, this.a - Math.PI / 2, this.a + angle - Math.PI / 2);
            this.ctx.stroke();
            this.ctx.arcNegative(this.w / 2, this.h, this.r, -this.a - Math.PI / 2, -this.a - angle - Math.PI / 2);
            this.a += angle;
        }
        this.ctx.stroke();
    },

    small: function(angle, dir){
        if(!process(angle))
            return;

        angle *= Math.PI / 2;

        if(dir)
            this.ctx.arc(this.w / 2, this.h, this.r, -Math.PI / 2, angle - Math.PI / 2);
        else
            this.ctx.arcNegative(this.w / 2, this.h, this.r, -Math.PI / 2, -angle - Math.PI / 2);
        this.ctx.stroke();
    },

    center: function(radius){
        if(!process(radius))
            return;

        this.ctx.arc(this.w / 2, this.h, radius * this.dr, -Math.PI, Math.PI);
        this.ctx.fill();
    }
};

function Bar(){
    this.init.apply(this, arguments);
}

Bar.prototype = {
    __proto__: ModulePart(Base),

    init: function(canvas, module){
        Base.prototype.init.call(this, canvas);

        this.module = module;
    },

    begin: function(numberSections){
        Base.prototype.begin.call(this);

        this.dx = this.w / numberSections;
        this.x = -this.dx;
    },

    next: function(colorName){
        this.x += this.dx;
        this.y = this.h;

        this.setColor(this.module.color[colorName]);
    },

    bar: function(size){
        this.ctx.rectangle(this.x, this.y, this.dx, -size * this.h);
        this.ctx.fill();
        this.y -= size * this.h;
    }
};

function History(){
    this.init.apply(this, arguments);
}

History.prototype = {
    __proto__: ModulePart(Base),

    packDir: "vertical",

    init: function(canvas, module){
        Base.prototype.init.call(this, canvas);

        this.module = module;
    },

    _line: {
        line: function(history){
            this.ctx.translate(this.dw * this.tx, this.h);
            this.ctx.scale(this.dw, -this.h / (this.max - this.min));
            this.ctx.translate(0, -this.min);

            this.ctx.moveTo(0, history[0] + (this.last[0] || 0));
            this.connection(history, 1);
            this.ctx.identityMatrix();
            this.ctx.stroke();

            this.incrementLast(history);
        },

        area: function(history){
            this.ctx.save();
            if(this.packDir === "vertical"){
                this.ctx.translate(this.dw * this.tx, this.h - (this.h * this.section / this.numberSections));
                this.ctx.scale(this.dw, -this.h / (this.max - this.min) / this.numberSections);
                this.ctx.translate(0, -this.min);
            } else {
                let x = this.w * this.section / this.numberSections;
                this.ctx.rectangle(x, 0, this.w / this.numberSections, this.h);
                this.ctx.clip();
                this.ctx.translate(x + this.dw * this.tx / this.numberSections, this.h);
                this.ctx.scale(this.dw / this.numberSections, -this.h / (this.max - this.min));
                this.ctx.translate(0, -this.min);
            }

            this.ctx.moveTo(0, history[0] + (this.last[0] || 0));
            this.connection(history, 1, true);
            if(!this.last.length)
                this.ctx.lineTo(history.length - 1, (this.last[history.length - 1] || 0) + this.min);
            this.ctx.lineTo(0, (this.last[0] || 0) + this.min);
            this.ctx.fill();
            this.ctx.restore();

            this.incrementLast(history);
        },

        areaUpDown: function(history){
            this.ctx.save();
            if(this.packDir){
                this.ctx.translate(this.dw * this.tx, this.h / 2);

                if(!this.section) // up
                    this.ctx.scale(this.dw, -this.h / (this.max - this.min) / 2);
                else // down
                    this.ctx.scale(this.dw, this.h / (this.max - this.min) / 2);

                this.ctx.translate(0, -this.min);
            } else {
                let x = this.section? 0 : this.w / 2;
                this.ctx.rectangle(2, 0, this.w / 2, this.h);
                this.ctx.clip();

                this.ctx.translate(x + this.dw * this.tx / 2, this.h);
                this.ctx.scale(this.dw / 2, -this.h / (this.max - this.min));
                this.ctx.translate(0, -this.min);
            }

            this.ctx.moveTo(0, history[0] + (this.last[0] || 0));
            this.connection(history, 1, true);

            if(!this.last.length)
                this.ctx.lineTo(history.length - 1, (this.last[history.length - 1] || 0) + this.min);

            this.ctx.lineTo(0, (this.last[0] || 0) + this.min);
            this.ctx.fill();
            this.ctx.restore();

            this.incrementLast(history);
        },

        stack: function(history){
            this.ctx.save();
            this.ctx.translate(this.dw * this.tx, this.h);
            this.ctx.scale(this.dw, -this.h / (this.max - this.min) / this.numberSections);
            this.ctx.translate(0, -this.min);

            this.ctx.moveTo(0, history[0] + (this.last[0] || 0));
            this.connection(history, 1, true);
            if(!this.last.length)
                this.ctx.lineTo(history.length - 1, (this.last[history.length - 1] || 0) + this.min);
            this.ctx.lineTo(0, (this.last[0] || 0) + this.min);
            this.ctx.fill();
            this.ctx.restore();

            this.incrementLast(history);
        },

        bar: function(history){
            this.ctx.save();
            this.ctx.translate(this.dw * (this.tx + this.section / this.numberSections), this.h);
            this.ctx.scale(this.dw, -this.h / (this.max - this.min));
            this.ctx.translate(0, this.min);

            for(var i = 0, l = history.length; i < l; ++i){
                this.ctx.rectangle(i, 0, 1 / this.numberSections, history[i] + (this.last[i] || 0));
                this.last[i] = history[i] + (this.last[i] || 0) - this.min;
            }

            this.ctx.fill();
            this.ctx.restore();
        }
    },

    _connection: {
        line: function(history, i, back){
            for(var l = history.length; i < l; ++i)
                this.ctx.lineTo(i, history[i] + (this.last[i] || 0));

            if(this.last.length && back){
                for(--i; i >= 0; --i)
                    this.ctx.lineTo(i, this.last[i]);
            }
        },

        straight: function(history, i, back){
            for(var l = history.length; i < l; ++i){
                this.ctx.lineTo(i - .5, history[i - 1] + (this.last[i - 1] || 0));
                this.ctx.lineTo(i - .5, history[i] + (this.last[i] || 0));
                this.ctx.lineTo(i, history[i] + (this.last[i] || 0));
            }
            if(this.last.length && back){
                this.ctx.lineTo(--i, this.last[i]);
                for(--i; i >= 0; --i){
                    this.ctx.lineTo(i + .5, this.last[i + 1]);
                    this.ctx.lineTo(i + .5, this.last[i]);
                    this.ctx.lineTo(i, this.last[i]);
                }
            }
        },

        curve: function(history, i, back){
            for(var l = history.length; i < l; ++i)
                this.ctx.curveTo(i - .5, history[i - 1] + (this.last[i - 1] || 0), i - .5, history[i] + (this.last[i] || 0), i, history[i] + (this.last[i] || 0));

            if(this.last.length && back){
                this.ctx.lineTo(--i, this.last[i]);
                for(--i; i >= 0; --i)
                    this.ctx.curveTo(i + .5, this.last[i + 1], i + .5, this.last[i], i, this.last[i]);
            }
        }
    },

    incrementLast: function(history){
        for(var i = 0, l = history.length; i < l; ++i)
            this.last[i] = history[i] + (this.last[i] || 0);
    },

    begin: function(numberSections, numberSteps, timeIndex, max, min){
        Base.prototype.begin.call(this);

        this.section = -1;
        this.numberSections = numberSections;

        this.dw = this.w / this.settings.graphSteps;
        let time = this.time[timeIndex || 0];
        var deltaT = (GLib.get_monotonic_time() / 1e3 - time * 1e3) / this.settings.interval;
        this.tx = this.settings.graphSteps + 2 - deltaT - numberSteps;

        this.min = min || 0;
        this.max = max || 1;

        this.line = this._line[this.settings[this.name + "Appearance"]];

        if(!this.line)
            this.line = this._line.area;

        if(this.settings[this.name + "Appearance"] === "line")
            this.ctx.setLineJoin(Cairo.LineJoin.ROUND);

        this.connection = this._connection[this.settings.graphConnection];
        if(!this.connection)
            this.connection = this._connection.line;

        this.last = [];
    },

    next: function(color){
        this.section++;
        if(this.settings[this.name + "Appearance"] !== "stack")
            this.last = [];

        if(typeof color === "string")
            color = this.module.color[color];
        this.setColor(color);
    }
};
