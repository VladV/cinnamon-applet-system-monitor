const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const St = imports.gi.St;

const Util = imports.misc.util;

const Applet = imports.ui.applet;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;

const Mainloop = imports.mainloop;

const uuid = "system-monitor@pixunil";
const path = imports.ui.appletManager.appletMeta[uuid].path;

if(imports.searchPath.indexOf(path) === -1)
    imports.searchPath.push(path);

const _ = imports._;
const bind = imports.bind;

const iconName = imports.iconName;

const Graph = imports.graph;

const Module = imports.modules.Module;
const GraphMenuItem = imports.modules.GraphMenuItem;

const Modules = {
    loadAvg: imports.modules.loadAvg,
    cpu: imports.modules.cpu,
    mem: imports.modules.mem,
    swap: imports.modules.swap,
    disk: imports.modules.disk,
    network: imports.modules.network,
    thermal: imports.modules.thermal,
    fan: imports.modules.fan
};

imports.searchPath.splice(imports.searchPath.indexOf(path), 1);

function SystemMonitorTooltip(){
    this._init.apply(this, arguments);
}

SystemMonitorTooltip.prototype = {
    __proto__: Tooltips.PanelItemTooltip.prototype,

    _init: function(applet, orientation){
        Tooltips.PanelItemTooltip.prototype._init.call(this, applet, "", orientation);

        this._tooltip = new St.BoxLayout({name: "Tooltip", vertical: true});
        this._tooltip.show_on_set_parent = false;
        Main.uiGroup.add_actor(this._tooltip);

        this._tooltip.get_text = function(){
            return true;
        };
    },

    addActor: function(actor){
        this._tooltip.add_actor(actor);
    }
};


function SystemMonitorApplet(){
    this.init.apply(this, arguments);
}

SystemMonitorApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    init: function(orientation, panelHeight, instanceId){
        Applet.IconApplet.prototype._init.call(this, orientation, panelHeight);

        this._applet_tooltip = new SystemMonitorTooltip(this, orientation);
        this._applet_tooltip.addActor(new St.Label({text: _("System Monitor")}));
        this.set_applet_icon_symbolic_name(iconName);

        this.modules = {};
        this.time = [];

        this.settings = {};
        this.settingProvider = new Settings.AppletSettings(this.settings, uuid, instanceId);
        this.settingProvider.bindProperties = function(keys, onSettingsChanged){
            keys.forEach(function(keyDash){
                let keyCamelCase = keyDash.replace(/-(.)/g, function(match, char){
                    return char.toUpperCase();
                });

                this.bindProperty(Settings.BindingDirection.IN, keyDash, keyCamelCase, onSettingsChanged);
            }, this);
        };

        // applet settings keys
        this.settingProvider.bindProperties([
            "show-icon", "interval", "byte-unit", "rate-unit", "thermal-unit", "order",
            "graph-size", "graph-steps", "graph-overview", "graph-connection"
        ], bind(this.onSettingsChanged, this));
        this.settingProvider.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "graph-type", "graphType", bind(this.onGraphTypeChanged, this));

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this.canvas = new St.DrawingArea({height: this.settings.graphSize});
        this.canvas.connect("repaint", bind(this.draw, this));
        this.canvasHolder = new PopupMenu.PopupBaseMenuItem({activate: false, sensitive: false});
        this.canvasHolder.actor.connect("scroll-event", bind(this.onScroll, this));
        this.canvasHolder.addActor(this.canvas, {span: -1, expand: true});

        this.graphs = [null];

        this.graphSubMenu = new PopupMenu.PopupSubMenuMenuItem(_("Graph"));

        this.graphMenuItems = [
            new GraphMenuItem(this, _("Overview"), 0)
        ];

        this.graphSubMenu.menu.addMenuItem(this.graphMenuItems[0]);

        let index = 1;
        for(let module in Modules){
            this.modules[module] = new Module(Modules[module], this.settings, this.time);
            module = this.modules[module];

            if(!module.unavailable){
                // add data displaying widgets
                this.menu.addMenuItem(module.menuItem);
                this._applet_tooltip.addActor(module.tooltip);

                // build the menu graph and graph menu item
                let graph = module.buildMenuGraph(this, index);

                if(graph){
                    this.graphs.push(graph);
                    this.graphMenuItems.push(module.graphMenuItem);
                    this.graphSubMenu.menu.addMenuItem(module.graphMenuItem);
                    index++;
                }
            }

            // apply the module setting keys
            if(module.settingKeys){
                this.settingProvider.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, module.name, module.name, bind(module.onSettingsChanged, module));
                this.settingProvider.bindProperties(module.settingKeys, bind(module.onSettingsChanged, module));
                module.onSettingsChanged();
            }

            if(module.panelWidget)
                this.actor.add(module.panelWidget.box);

            module.modules = this.modules;
        }

        // after all modules are ready, create the overview graphs
        this.graphs[0] = [
            new Graph.PieOverview(this.canvas, this.modules, this.settings),
            new Graph.ArcOverview(this.canvas, this.modules, this.settings)
        ];

        this.menu.addMenuItem(this.canvasHolder);
        this.menu.addMenuItem(this.graphSubMenu);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem);
        this.menu.addAction(_("System Monitor"), function(){
            let appSys = Cinnamon.AppSystem.get_default();
            let gsmApp = appSys.lookup_app("gnome-system-monitor.desktop");
            gsmApp.activate();
        });

        this.onSettingsChanged();
        this.onGraphTypeChanged();

        this.getData();

        this.paintTimeline = new Clutter.Timeline({duration: 100, repeat_count: -1});
        this.paintTimeline.connect("new-frame", bind(this.paint, this));
        this.paintTimeline.start();
    },

    getData: function(){
        // calculate the time since the last update and save the time
        let time = GLib.get_monotonic_time() / 1e6;
        let delta = time - this.time[0];
        this.time[0] = time;

        // generate data
        for(let module in this.modules)
            this.modules[module].getData(delta);

        // data generated, now update the text
        this.updateText();

        // queue the next data request
        this.timeout = Mainloop.timeout_add(this.settings.interval, bind(this.getData, this));

        // refresh independently of the drawing timeline the Overview graph
        if(this.settings.graphType === 0)
            this.canvas.queue_repaint();
    },

    paint: function(timeline, time, once){
        // do not repaint Overview graph (it is handled by getData), but when the graphType is updated
        if(this.menu.isOpen && (this.settings.graphType !== 0 || once))
            this.canvas.queue_repaint();

        for(let module in this.modules){
            let panelWidget = this.modules[module].panelWidget;

            if(panelWidget)
                panelWidget.paint();
        }
    },

    draw: function(){
        let graph;

        if(this.settings.graphType === 0)
            graph = this.graphs[0][this.settings.graphOverview];
        else
            graph = this.graphs[this.settings.graphType];

        graph.draw();
        graph.ctx.$dispose();
    },

    updateText: function(){
        for(let module in this.modules)
            this.modules[module].update();
    },

    on_applet_clicked: function(){
        this.menu.toggle();
        if(this.menu.isOpen) this.updateText();
    },

    on_applet_removed_from_panel: function(){
        Mainloop.source_remove(this.timeout);
        this.paintTimeline.run_dispose();
        this.settingProvider.finalize();
    },

    onSettingsChanged: function(){
        this.canvas.set_height(this.settings.graphSize);

        // use the private property _applet_icon_box for showing / hiding the icon
        this._applet_icon_box.visible = this.settings.showIcon;

        this.updateText();
    },

    onGraphTypeChanged: function(){
        this.graphMenuItems.forEach(function(item){
            item.setShowDot(false);
        });

        let show = this.settings.graphType !== -1;
        this.graphSubMenu.actor.visible = show;
        this.canvasHolder.actor.visible = show;

        if(show){
            this.graphMenuItems[this.settings.graphType].setShowDot(true);
            this.paint(this.paintTimeline, 0, true);
        }
    },

    onScroll: function(actor, event){
        let direction = event.get_scroll_direction();
        let graphType = this.settings.graphType;

        if(direction === Clutter.ScrollDirection.DOWN && graphType < this.graphs.length - 1){
            // scrolling down, so increment the graphType pointer until a active item is hit
            do {
                if(++graphType === this.graphs.length)
                    return;
            } while(!this.graphMenuItems[graphType].actor.visible);
        } else if(direction === Clutter.ScrollDirection.UP && graphType > 0){
            // scrolling up, so decrement the graphType pointer until a active item is hit
            do {
                graphType--;
            } while(!this.graphMenuItems[graphType].actor.visible);
        }

        this.settings.graphType = graphType;

        this.onGraphTypeChanged();
    },

    launchReadme: function(){
        Util.spawnCommandLine("xdg-open https://github.com/pixunil/cinnamon-applet-system-monitor/blob/master/README.md#settings");
    }
};

function main(metadata, orientation, panelHeight, instanceId){
    return new SystemMonitorApplet(orientation, panelHeight, instanceId);
}
