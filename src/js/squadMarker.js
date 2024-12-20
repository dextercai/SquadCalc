import { App } from "../app.js";
import { ellipse } from "./libs/leaflet.ellipse.js";
import { Marker, Circle, CircleMarker, Popup, polyline } from "leaflet";
import { targetIcon1, targetIconAnimated1, targetIconDisabled } from "./squadIcon.js";
import SquadSimulation from "./squadSimulation.js";
import SquadFiringSolution from "./squadFiringSolution.js";
import i18next from "i18next";
import { sendMarkerData, sendTargetData } from "./squadCalcAPI.js";
import { antPath } from "leaflet-ant-path";


/*
 * Global Squad Marker Class 
*/
export var squadMarker = Marker.extend({
    options: {
        draggable: true,
        riseOnHover: true,
        keyboard: false,
        animate: true,
    },

    // Constructor
    initialize: function (latlng, options, map) {
        this.map = map;
        Marker.prototype.initialize.call(this, latlng, options);
        this.on("dragstart", this._handleDragStart, this);
        this.on("dragend", this._handleDragEnd, this);
    },

    /**
     * Force a given event to stay inside the map bounds
     * @param {e} [event] - event
     * @returns {e} - same event with corrected Latlng 
     */
    keepOnMap: function(e){
        if (e.latlng.lng > this.map.tilesSize) {e.latlng.lng = this.map.tilesSize;}
        if (e.latlng.lat < -this.map.tilesSize ) {e.latlng.lat = -this.map.tilesSize;}
        if (e.latlng.lng < 0) {e.latlng.lng = 0;}
        if (e.latlng.lat > 0) {e.latlng.lat = 0;}
        return e;
    },
});

export var squadWeaponMarker = squadMarker.extend({

    initialize: function (latlng, options, map) {
        var circlesColor = "#00137f";
        var cursorClass;

        squadMarker.prototype.initialize.call(this, latlng, options, map);

        if (App.userSettings.cursor) {
            cursorClass = "default";
        } else {
            cursorClass = "crosshair";
        }
        
        this.posPopUpOptions = {
            autoPan: false,
            autoClose: false,
            closeButton: false,
            closeOnEscapeKey: false,
            bubblingMouseEvents: false,
            interactive: false,
            className: "posPopUpWeapon",
            minWidth: 100,
            offset: [0, -20],
        };

        this.maxDistCircleOn = {
            radius: App.activeWeapon.getMaxDistance() * this.map.gameToMapScale,
            opacity: 0.7,
            color: circlesColor,
            fillOpacity: 0,
            weight: 2,
            autoPan: false,
            className: cursorClass,
        };

        this.minDistCircleOn = {
            radius: App.activeWeapon.minDistance * this.map.gameToMapScale,
            opacity: 0.7,
            color: circlesColor,
            fillOpacity: 0.2,
            weight: 1,
            autoPan: false,
            className: cursorClass,
        };

        this.minMaxDistCircleOff = {
            radius: 0,
            opacity: 0,
            fillOpacity: 0,
            className: cursorClass,
        };

        this.miniCircleOptions = {
            radius: 4,
            opacity: 0,
            color: circlesColor,
            fillOpacity: 0,
            weight: 1,
            autoPan: false,
            className: cursorClass,
        };


        this.angleType = App.activeWeapon.angleType;
        this.heightPadding = 0;

        // Create the min/max range markers
        this.minRangeMarker = new Circle(latlng, this.minDistCircleOn).addTo(this.map.markersGroup);
        this.rangeMarker = new Circle(latlng, this.maxDistCircleOn).addTo(this.map.markersGroup);
        this.miniCircle = new CircleMarker(latlng, this.miniCircleOptions).addTo(this.map.markersGroup);
        
        // Initiate Position PopUp
        this.posPopUp = new Popup(this.posPopUpOptions).setLatLng(latlng).addTo(this.map.markersGroup).close();

        if (!App.userSettings.weaponMinMaxRange) {
            this.minRangeMarker.setStyle(this.minMaxDistCircleOff);
            this.rangeMarker.setStyle(this.minMaxDistCircleOff);
        }
        // Hide minRangeMarker if weapon doesn't have minimum range
        if (this.minRangeMarker.getRadius() == 0) {
            this.minRangeMarker.setStyle(this.minMaxDistCircleOff);
        }

        this.getIcon();

        // Report marker to squadcalc API if API is configured
        if (process.env.API_URL) {
            sendMarkerData({
                lat: this._latlng.lat,
                lng: this._latlng.lng,
                weapon: App.activeWeapon.name,
                map: App.minimap.activeMap.name,
            });
        }

        // Custom events handlers
        this.on("click", this._handleClick, this);
        this.on("drag", this._handleDrag, this);
        this.on("dragStart", this._handleDragStart, this);
        this.on("dragEnd", this._handleDragEnd, this);
        this.on("dblclick", this._handleDblclick, this);
        this.on("contextmenu", this._handleContextMenu, this);
    },


    getIcon: function(){
        if (this.map.activeWeaponsMarkers.getLayers().length === 0) {
            this.setIcon(App.activeWeapon.marker);
        }
    },

    updateIcon: function(){
        if (this.map.activeWeaponsMarkers.getLayers().length === 1) {
            this.setIcon(App.activeWeapon.marker);
        }
    },

    /**
     * Remove the Weapon marker and every object tied
     * @param {this}
     */
    delete: function(){

        // Unbind all custom event handlers
        this.off();

        this.removeFrom(this.map.activeWeaponsMarkers);

        if (this.map.activeWeaponsMarkers.getLayers().length === 0) { 
            this.map.deleteTargets();
        } else {
            // Set default icon on remaining weapon
            this.map.activeWeaponsMarkers.getLayers()[0].setIcon(App.activeWeapon.marker);
        }

        // Delete the weapon marker and everything tied to it
        this.minRangeMarker.removeFrom(this.map.markersGroup).remove();
        this.rangeMarker.removeFrom(this.map.markersGroup).remove();
        this.miniCircle.removeFrom(this.map.markersGroup).remove();
        this.posPopUp.removeFrom(this.map.markersGroup).remove();
        this.removeFrom(this.map.markersGroup).removeFrom(this.map.activeWeaponsMarkers);
        this.remove();

        // Update remaining targets if they exists
        this.map.updateTargets();
    },


    /**
     * update calcs, spread markers
     */
    updateWeapon: function(){

        var radiusMax = App.activeWeapon.getMaxDistance() * this.map.gameToMapScale;
        var radiusMin = App.activeWeapon.minDistance * this.map.gameToMapScale;

        this.angleType = App.activeWeapon.angleType;

        this.minRangeMarker.setRadius(radiusMin);
        this.rangeMarker.setRadius(radiusMax);


        if (!App.userSettings.weaponMinMaxRange) {
            this.minRangeMarker.setStyle(this.minMaxDistCircleOff);
            this.rangeMarker.setStyle(this.minMaxDistCircleOff);
        } else {
            // Update MinRange circle opacity
            if (this.minRangeMarker.getRadius() != 0) {
                this.minRangeMarker.setStyle(this.minDistCircleOn);
            } else {
                this.minRangeMarker.setStyle(this.minMaxDistCircleOff);
            }
            this.rangeMarker.setStyle(this.maxDistCircleOn);
        }

        this.updateIcon();
    },


    _handleContextMenu: function(e){
        this.delete(e);
    },

    _handleDrag: function (e) {
        e = this.keepOnMap(e);
        this.setLatLng(e.latlng);
        this.rangeMarker.setLatLng(e.latlng);
        this.minRangeMarker.setLatLng(e.latlng);
        this.miniCircle.setLatLng(e.latlng);

        // Update Position PopUp Content
        if (App.userSettings.weaponDrag) { 
            this.posPopUp.setLatLng(e.latlng);
            this.posPopUp.setContent(this.map.getKP(-e.latlng.lat, e.latlng.lng, 4)); 
        }
    },


    _handleClick: function(weapon) {
        const DIALOG = document.getElementById("weaponInformation");
        var name = App.activeWeapon.name;

        // Logo
        $(".weaponIcon").first().attr("src", App.activeWeapon.logo);

        // Informations
        if (App.activeWeapon.name === "M1064M121") {
            name = `${i18next.t("weapons:"+name)} (${$(".dropbtn3 option:selected" ).text()})`;
        }  else {
            name = `${i18next.t("weapons:"+name)}`;
        }
        
        $(".infName").first().text(name);
        $(".infRange").first().text(`${App.activeWeapon.minDistance + i18next.t("common:m")} - ${App.activeWeapon.maxDistance.toFixed(0) + i18next.t("common:m")}`);
        $(".infMOA").first().text(`${App.activeWeapon.moa} (${(App.activeWeapon.moa / 60).toFixed(1) + i18next.t("common:°")})`);
        $(".infMinDistance").first().text(App.activeWeapon.minDistance + i18next.t("common:m"));
        $(".infMaxDistance").first().text(App.activeWeapon.maxDistance.toFixed(1) + i18next.t("common:m"));
        $(".inf100damage").first().text(App.activeWeapon.hundredDamageRadius.toFixed(1) + i18next.t("common:m"));
        $(".inf25damage").first().text(App.activeWeapon.twentyFiveDamageRadius.toFixed(1) + i18next.t("common:m"));
        $(".infVelocity").first().text(`${App.activeWeapon.velocity + i18next.t("common:m")}/${i18next.t("common:s")}`);

        if (["Mortar", "UB-32"].includes(App.activeWeapon.name)) {
            $("#angleChoice").hide();
        } else {
            $("#angleChoice").show();
        }
        

        // Angle
        if (this.angleType ==="high"){
            $("#angleChoiceHigh").prop("checked", true);
            $("#angleChoiceLow").prop("checked", false);
        } else {
            $("#angleChoiceHigh").prop("checked", false);
            $("#angleChoiceLow").prop("checked", true);
        }

        // Additional height
        $(".heightPadding input").val(this.heightPadding);
        


        // Add listener that update angle/height & refresh targets
        weapon = weapon.sourceTarget;
        $("input[type=radio][name=angleChoice]").on("change", weapon, function() {
            weapon.angleType = this.value;
            App.minimap.updateTargets();
        });

        $(".heightPadding input").on("change", weapon, function() {
            this.value = Math.max(0, Math.min(this.value, 100)); // ensure 0 < value < 100
            weapon.heightPadding = parseFloat(this.value);
            App.minimap.updateTargets();
        });

        DIALOG.showModal();
    },

    // Catch this events so user can't place a target by mistake while trying to delete weapon
    _handleDblclick: function(){},

    _handleDragStart: function () {

        //$(".leaflet-marker-icon").css("cursor", "grabbing");
        this.map.mouseLocationPopup.close();
        this.map.off("mousemove", this.map._handleMouseMove);

        this.map.activeTargetsMarkers.eachLayer(function (layer) {
            layer.calcMarker1.setContent("  ");
            layer.calcMarker2.setContent("  ");
            layer.spreadMarker1.setStyle({opacity: 0, fillOpacity: 0});
            layer.spreadMarker2.setStyle({opacity: 0, fillOpacity: 0});
            layer.twentyFiveDamageRadius.setStyle({opacity: 0, fillOpacity: 0});
            layer.hundredDamageRadius.setStyle({opacity: 0, fillOpacity: 0});
        }); 
        
        if (App.userSettings.weaponDrag) { this.posPopUp.openOn(this.map); }
        
        this.miniCircle.setStyle({opacity: 1});
    },

    _handleDragEnd: function () {

        if (App.userSettings.keypadUnderCursor){
            this.map.on("mousemove", this.map._handleMouseMove);
        }
        this.miniCircle.setStyle({opacity: 0});
        this.posPopUp.close();
        //this.setOpacity(0);
        this.map.updateTargets();

        // Report marker to squadcalc API if API is configured
        if (process.env.API_URL) {
            sendMarkerData({
                lat: this._latlng.lat,
                lng: this._latlng.lng,
                weapon: App.activeWeapon.name,
                map: App.minimap.activeMap.name,
            });
        }
    },
});


export var squadTargetMarker = squadMarker.extend({

    initialize: function (latlng, options, map) {
        var cursorClass;
        var popUpOptions_weapon1;
        var popUpOptions_weapon2;
        var weaponPos;
        var trajectoriesOptions;

        //Util.setOptions(this, options);
        squadMarker.prototype.initialize.call(this, latlng, options, map);
        
        if (App.userSettings.cursor) {
            cursorClass = "default";
        } else {
            cursorClass = "crosshair";
        }

        this.posPopUpOptions = {
            autoPan: false,
            autoClose: false,
            closeButton: false,
            closeOnEscapeKey: false,
            bubblingMouseEvents: false,
            interactive: false,
            className: "posPopUpTarget",
            minWidth: 100,
            offset: [0, -10],
        };
        
        popUpOptions_weapon1 = {
            autoPan: false,
            autoClose: false,
            closeButton: false,
            closeOnEscapeKey: false,
            bubblingMouseEvents: false,
            interactive: false,
            className: "calcPopup",
            minWidth: 100,
            offset: [-65, 0],
        };

        popUpOptions_weapon2 = {
            closeButton: false,
            className: "calcPopup2",
            autoClose: false,
            closeOnEscapeKey: false,
            autoPan: false,
            bubblingMouseEvents: false,
            interactive: false,
            minWidth: 100,
            offset: [68, 0],
        };

        trajectoriesOptions = { 
            use: polyline, 
            delay: 500, 
            dashArray: [10, 30], 
            weight: 2, 
            color: "#FFFFFF", 
            pulseColor: App.mainColor, 
            opacity: 0, 
            className: cursorClass 
        };

        this.spreadOptionsOn = {
            opacity: 1,
            fillOpacity: 0.2,
            color: App.mainColor,
            weight: 1.3,
            className: cursorClass,
        };

        this.spreadOptionsOff = {
            opacity: 0,
            fillOpacity: 0,
            className: cursorClass,
        };

        this.hundredDamageCircleOn = {
            radius: 0,
            opacity: 1,
            fillOpacity: 0,
            dashArray: "5,3",
            color: App.mainColor,
            weight: 1.3,
            className: cursorClass,
        };

        this.twentyFiveDamageCircleOn = {
            radius: 0,
            opacity: 1,
            fillOpacity: 0,
            dashArray: "5,6",
            color: App.mainColor,
            weight: 1.3,
            className: cursorClass,
        };

        this.miniCircleOptions = {
            radius: 4,
            opacity: 0,
            color: App.mainColor,
            fillOpacity: 0,
            weight: 1,
            autoPan: false,
            className: cursorClass,
        };

        this.isDragging = false;

        // Create marker
        this.addTo(this.map.activeTargetsMarkers);
        this.miniCircle = new CircleMarker(latlng, this.miniCircleOptions).addTo(this.map.markersGroup);
        this.firingSolution1 = new SquadFiringSolution(this.map.activeWeaponsMarkers.getLayers()[0].getLatLng(), this.getLatLng(), this.map, this.map.activeWeaponsMarkers.getLayers()[0].heightPadding);
        
        // Report target to squadcalc API if API is configured
        if (process.env.API_URL) {
            sendTargetData({
                lat: latlng.lat,
                lng: latlng.lng,
                weapon: App.activeWeapon.name,
                map: App.minimap.activeMap.name,
            });
        }

        // Calc PopUps
        this.calcMarker1 = new Popup(popUpOptions_weapon1).setLatLng(latlng).addTo(this.map.markersGroup);
        this.calcMarker2 = new Popup(popUpOptions_weapon2).setLatLng(latlng).addTo(this.map.markersGroup);
        this.calcMarker1.setContent(this.getContent(this.firingSolution1, this.map.activeWeaponsMarkers.getLayers()[0].angleType)).openOn(this.map);
        
        // Initiate Trajectories Paths
        this.pathTrajectory1 = antPath([[0,0], [0,0]], trajectoriesOptions).addTo(this.map);
        this.pathTrajectory2 = antPath([[0,0], [0,0]], trajectoriesOptions).addTo(this.map);

        // posPopUp
        this.posPopUp = new Popup(this.posPopUpOptions).setLatLng(latlng).addTo(this.map.markersGroup).close();

        // If two weapons already on the map
        if (this.map.activeWeaponsMarkers.getLayers().length === 2) {
            weaponPos = this.map.activeWeaponsMarkers.getLayers()[1].getLatLng();
            this.firingSolution2 = new SquadFiringSolution(weaponPos, this.getLatLng(), this.map, this.map.activeWeaponsMarkers.getLayers()[1].heightPadding);
            this.calcMarker1.setContent(`1. ${this.getContent(this.firingSolution1, this.map.activeWeaponsMarkers.getLayers()[0].angleType)}`);
            this.calcMarker2.setContent(`2. ${this.getContent(this.firingSolution2, this.map.activeWeaponsMarkers.getLayers()[1].angleType)}`).openOn(this.map);
        }

        // Initiate Spread Ellipse
        this.spreadMarker1 = new ellipse(latlng, [0, 0], 0, this.spreadOptionsOff).addTo(this.map.markersGroup);
        this.spreadMarker2 = new ellipse(latlng, [0, 0], 0, this.spreadOptionsOff).addTo(this.map.markersGroup);
        this.updateSpread();

        // Initiate Spread Ellipse
        this.hundredDamageRadius = new ellipse(latlng, [0, 0], 0, this.hundredDamageCircleOn).addTo(this.map.markersGroup);
        this.twentyFiveDamageRadius = new ellipse(latlng, [0, 0], 0, this.twentyFiveDamageCircleOn).addTo(this.map.markersGroup);
        this.updateDamageRadius();

        this.createIcon();

        // Custom events handlers
        this.on("click", this._handleClick, this);
        this.on("drag", this._handleDrag, this);
        this.on("dragStart", this._handleDragStart, this);
        this.on("dragEnd", this._handleDragEnd, this);
        this.on("contextmenu", this._handleContextMenu, this);

        if (App.hasMouse){
            this.on("mouseover", this._handleMouseOver, this);
            this.on("mouseout", this._handleMouseOut, this);
        }

    },


    /**
     * Remove the target marker and every object tied
     */
    delete: function(){

        // Unbind all custom event handlers
        this.off();

        // Remove everything attached from the map
        this.spreadMarker1.removeFrom(this.map.markersGroup).remove();
        this.spreadMarker2.removeFrom(this.map.markersGroup).remove();
        this.calcMarker1.removeFrom(this.map.markersGroup).remove();
        this.calcMarker2.removeFrom(this.map.markersGroup).remove();
        this.miniCircle.removeFrom(this.map.markersGroup).remove();
        this.hundredDamageRadius.removeFrom(this.map.markersGroup).remove();
        this.twentyFiveDamageRadius.removeFrom(this.map.markersGroup).remove();
        this.posPopUp.removeFrom(this.map.markersGroup).remove();
        this.pathTrajectory1.removeFrom(this.map.markersGroup).remove();
        this.pathTrajectory2.removeFrom(this.map.markersGroup).remove();
        
        // Remove the marker itself
        this.removeFrom(this.map.markersGroup).removeFrom(this.map.activeTargetsMarkers).remove();
    
        // If that was the last Marker on the map, hide "delete all" buttons
        if (this.map.activeTargetsMarkers.getLayers().length === 0) {
            $(".btn-delete").hide();
        }

    },

    getContent: function(firingSolution, angleType){
        const DIST = firingSolution.distance;
        const BEARING = firingSolution.bearing;
        var heightDiff = firingSolution.heightDiff.toFixed(0);
        var content;
        var elevation;
        var timeOfFlight;

        // Avoid "-0"
        if (Math.sign(heightDiff) === 1 || heightDiff == -0) {
            heightDiff = `+${Math.abs(heightDiff)}`;
        }

        if (angleType === "high"){
            elevation = firingSolution.elevation.high;
            timeOfFlight = firingSolution.timeOfFlight.high;
        } else {
            elevation = firingSolution.elevation.low;
            timeOfFlight = firingSolution.timeOfFlight.low;
        }
        
        if (isNaN(elevation.rad)) {
            elevation = "---";
            timeOfFlight = "---";
        } else {
            if (App.activeWeapon.unit === "mil"){
                elevation = elevation.mil.toFixed(0);
            } else {
                elevation = elevation.deg.toFixed(1);
            }
            timeOfFlight = `${timeOfFlight.toFixed(1)}<span data-i18n="common:m">${i18next.t("common:s")}</span>`;
        }

        content = `<span class=calcNumber></span></br><span>${elevation}</span>`;

        if (App.userSettings.showBearing) {
            content += `<br><span class=bearingUiCalc>${BEARING.toFixed(1)}<span data-i18n="common:°">${i18next.t("common:°")}</span></span>`;
        }

        if (App.userSettings.showTimeOfFlight) {
            content += `<br><span class=bearingUiCalc>${timeOfFlight}</span>`;
        } 

        if (App.userSettings.showDistance) {
            content += `<br><span class=bearingUiCalc>${DIST.toFixed(0)}<span data-i18n="common:m">${i18next.t("common:m")}</span></span>`;
        }
        
        if (App.userSettings.showHeight) {
            content += `<br><span class=bearingUiCalc>${heightDiff}<span data-i18n="common:m">${i18next.t("common:m")}</span></span>`;
        }

        return content;
    },


    updateSpread: function(){
        var spreadParameters;
        var layers = this.map.activeWeaponsMarkers.getLayers();
        var gameToMapScale = this.map.gameToMapScale;
    
        // No spread wanted, return
        if (!App.userSettings.spreadRadius) {
            this.spreadMarker1.setStyle(this.spreadOptionsOff);
            this.spreadMarker2.setStyle(this.spreadOptionsOff);
            return;
        }
    
        const setSpreadMarker = (marker, firingSolution, layerIndex) => {
            if (!isNaN(firingSolution.elevation.high.rad)) {
                const angleType = layers[layerIndex].angleType;
                spreadParameters = angleType === "high" ? firingSolution.spreadParameters.high : firingSolution.spreadParameters.low;
                marker.setRadius([(spreadParameters.semiMajorAxis * gameToMapScale) / 2, (spreadParameters.semiMinorAxis * gameToMapScale) / 2]);
                marker.setTilt(firingSolution.bearing);
                marker.setStyle(this.spreadOptionsOn);
            } else {
                marker.setStyle(this.spreadOptionsOff);
            }
        };
    
        // Spread for Weapon1
        setSpreadMarker(this.spreadMarker1, this.firingSolution1, 0);
    
        // Spread for Weapon2
        if (layers.length === 2) {
            setSpreadMarker(this.spreadMarker2, this.firingSolution2, 1);
        } else {
            this.spreadMarker2.setStyle(this.spreadOptionsOff);
        }
    },

    updateDamageRadius: function(){
        const RADIUS100 = App.activeWeapon.hundredDamageRadius * this.map.gameToMapScale;
        const RADIUS25 = App.activeWeapon.twentyFiveDamageRadius * this.map.gameToMapScale;
        var baseRadiiX = this.spreadMarker1.getRadius().x;
        var baseRadiiY = this.spreadMarker1.getRadius().y;
        var baseBearing = 0;

        // If user didn't activate damage radius
        if (!App.userSettings.damageRadius) {
            this.hundredDamageRadius.setStyle(this.spreadOptionsOff);
            this.twentyFiveDamageRadius.setStyle(this.spreadOptionsOff);
            return;
        }

        if (App.userSettings.spreadRadius){

            if (this.map.activeWeaponsMarkers.getLayers().length == 2) {

                if (isNaN(this.firingSolution1.elevation.high.rad) && isNaN(this.firingSolution2.elevation.high.rad)) {
                    this.hundredDamageRadius.setStyle(this.spreadOptionsOff);
                    this.twentyFiveDamageRadius.setStyle(this.spreadOptionsOff);
                    return;
                }

                if (isNaN(this.firingSolution1.elevation.high.rad)) {
                    baseRadiiX = this.spreadMarker2.getRadius().x;
                    baseRadiiY = this.spreadMarker2.getRadius().y;
                    baseBearing = this.firingSolution2.bearing;
                } else if (isNaN(this.firingSolution2.elevation.high.rad)) {
                    baseRadiiX = this.spreadMarker1.getRadius().x;
                    baseRadiiY = this.spreadMarker1.getRadius().y;
                    baseBearing = this.firingSolution1.bearing;
                } else {
                    // If there is two firing solutions, just draw a circle with the biggest radius found in the spreads
                    // Not perfectly accurate but that will do
                    baseRadiiX = Math.max(this.spreadMarker1.getRadius().x, this.spreadMarker2.getRadius().x, this.spreadMarker1.getRadius().y, this.spreadMarker2.getRadius().y);
                    baseRadiiY = baseRadiiX;
                }

            } else {
                if (isNaN(this.firingSolution1.elevation.high.rad)) {
                    this.hundredDamageRadius.setStyle(this.spreadOptionsOff);
                    this.twentyFiveDamageRadius.setStyle(this.spreadOptionsOff);
                    return;
                }
                baseRadiiX = this.spreadMarker1.getRadius().x;
                baseRadiiY = this.spreadMarker1.getRadius().y;
                baseBearing = this.firingSolution1.bearing;
            }

            this.hundredDamageRadius.setRadius([baseRadiiX + RADIUS100, baseRadiiY + RADIUS100]);
            this.twentyFiveDamageRadius.setRadius([baseRadiiX + RADIUS25, baseRadiiY + RADIUS25]);
        } else {

            if (this.map.activeWeaponsMarkers.getLayers().length == 2) {
                if (isNaN(this.firingSolution1.elevation.high.rad) && isNaN(this.firingSolution2.elevation.high.rad)) {
                    this.hundredDamageRadius.setStyle(this.spreadOptionsOff);
                    this.twentyFiveDamageRadius.setStyle(this.spreadOptionsOff);
                    return;
                }
            } else {
                if (isNaN(this.firingSolution1.elevation.high.rad)) {
                    this.hundredDamageRadius.setStyle(this.spreadOptionsOff);
                    this.twentyFiveDamageRadius.setStyle(this.spreadOptionsOff);
                    return;
                }
            }

            this.hundredDamageRadius.setRadius([RADIUS100, RADIUS100]);
            this.twentyFiveDamageRadius.setRadius([RADIUS25, RADIUS25]);
        }

        this.hundredDamageRadius.setStyle(this.hundredDamageCircleOn);
        this.twentyFiveDamageRadius.setStyle(this.twentyFiveDamageCircleOn);
        this.hundredDamageRadius.setTilt(baseBearing);
        this.twentyFiveDamageRadius.setTilt(baseBearing);
        
    },


    updateCalc: function(){

        this.firingSolution1 = new SquadFiringSolution(this.map.activeWeaponsMarkers.getLayers()[0].getLatLng(), this.getLatLng(), this.map, this.map.activeWeaponsMarkers.getLayers()[0].heightPadding);
        this.calcMarker1.setContent(this.getContent(this.firingSolution1, this.map.activeWeaponsMarkers.getLayers()[0].angleType));

        if (this.map.activeWeaponsMarkers.getLayers().length === 2) {
            this.firingSolution2 = new SquadFiringSolution(this.map.activeWeaponsMarkers.getLayers()[1].getLatLng(), this.getLatLng(), this.map, this.map.activeWeaponsMarkers.getLayers()[1].heightPadding);
            this.calcMarker1.setContent(`1. ${this.getContent(this.firingSolution1, this.map.activeWeaponsMarkers.getLayers()[0].angleType)}`);
            this.calcMarker2.setContent(`2. ${this.getContent(this.firingSolution2, this.map.activeWeaponsMarkers.getLayers()[1].angleType)}`).openOn(this.map);
        } else {
            this.calcMarker2.close();
        }
        this.updateSpread();
        this.updateDamageRadius();
    },

    updateIcon: function(){
        var icon;

        if (this.map.activeWeaponsMarkers.getLayers().length === 1) {
            if (isNaN(this.firingSolution1.elevation.high.rad)){
                icon = targetIconDisabled;
            } else {
                icon = targetIcon1;
            }
        }
        else {
            if (isNaN(this.firingSolution1.elevation.high.rad) && isNaN(this.firingSolution2.elevation.high.rad)){
                icon = targetIconDisabled;
            } else {
                icon = targetIcon1;
            }
        }
       
        // hack leaflet to avoid unwanted click event
        // https://github.com/Leaflet/Leaflet/issues/5067
        setTimeout((function (this2) {
            return function () {
                this2.setIcon(icon);
            };
        })(this));
    },

    createIcon: function(){
        var icon;

        if (this.map.activeWeaponsMarkers.getLayers().length === 1) {
            if (isNaN(this.firingSolution1.elevation.low.rad)){
                icon = targetIconDisabled;
            }
            else {
                if (this.options.animate){ 
                    icon = targetIconAnimated1;
                    this.options.animate = true;
                }
                else { icon = targetIcon1; }
            }
        }
        else {
            if (isNaN(this.firingSolution1.elevation.high.rad) && isNaN(this.firingSolution2.elevation.high.rad)){
                icon = targetIconDisabled;
            }
            else {
                if (this.options.animate){ 
                    icon = targetIconAnimated1;
                    this.options.animate = true;
                }
                else { icon = targetIcon1; }
            }
        }
        
        this.setIcon(icon);
    },

    _handleClick: function() {
        const DIALOG = document.getElementById("calcInformation");
        var simulation1;
        var simulation2;
        var weaponPos1;
        var weaponPos2;
        var heightPath1;
        var heightPath2;
              
        $("#sim1").addClass("active");
        $("#sim2").removeClass("active");
        $("#canvasControls > .active").first().removeClass("active");
        $("#canvasControls > button").first().addClass("active");

        weaponPos1 = this.map.activeWeaponsMarkers.getLayers()[0].getLatLng();
        heightPath1 = this._map.heightmap.getHeightPath(weaponPos1, this.getLatLng());
        simulation1 = new SquadSimulation("#sim1", this.firingSolution1, heightPath1, this.map.activeWeaponsMarkers.getLayers()[0].angleType, App.activeWeapon.unit);
        $("#canvasControls").css("display", "none");

        if (this.map.activeWeaponsMarkers.getLayers().length === 2){
            $("#canvasControls").css("display", "block");
            weaponPos2 = this.map.activeWeaponsMarkers.getLayers()[1].getLatLng();
            heightPath2 = this._map.heightmap.getHeightPath(weaponPos2, this.getLatLng());
            simulation2 = new SquadSimulation("#sim2", this.firingSolution2, heightPath2, this.map.activeWeaponsMarkers.getLayers()[1].angleType, App.activeWeapon.unit);
        }

        // If the user close the modal, stop the animation
        // ...or it does crazy stuff if he reopen it before the animation runs out
        DIALOG.addEventListener("close", function(){
            cancelAnimationFrame(simulation1.animationFrame);
            if (simulation2){ cancelAnimationFrame(simulation2.animationFrame);}
        });

        DIALOG.showModal();
    },

    // Keep the marker on map & update calc while dragging
    _handleDrag: function (e) {

        // When dragging marker out of bounds, block it at the edge
        e = this.keepOnMap(e);

        // Update Positions
        this.setLatLng(e.latlng);
        this.calcMarker1.setLatLng(e.latlng);
        this.spreadMarker1.setLatLng(e.latlng);
        this.calcMarker2.setLatLng(e.latlng);
        this.spreadMarker2.setLatLng(e.latlng);
        this.miniCircle.setLatLng(e.latlng);
        this.hundredDamageRadius.setLatLng(e.latlng);
        this.twentyFiveDamageRadius.setLatLng(e.latlng);

        // Update Position PopUp Content
        if (App.userSettings.targetDrag) {
            this.posPopUp.setLatLng(e.latlng).setContent(this.map.getKP(-e.latlng.lat, e.latlng.lng, 4));
        }

        // On mobile save performance
        if (!App.hasMouse) return;

        // Update bearing/elevation/spread marker
        this.updateCalc(); 

        // Update TrajectoryPath
        this.pathTrajectory1.setLatLngs([this.map.activeWeaponsMarkers.getLayers()[0].getLatLng(), e.latlng]).setStyle({ opacity: 1 });
        if (this.map.activeWeaponsMarkers.getLayers()[1]) {
            this.pathTrajectory2.setLatLngs([this.map.activeWeaponsMarkers.getLayers()[1].getLatLng(), e.latlng]).setStyle({ opacity: 1 });
        }
        
    },

    
    _handleDragStart: function () {
        this.isDragging = true;
        this.map.mouseLocationPopup.close();
        this.map.off("mousemove", this.map._handleMouseMove);

        if (!App.hasMouse) {
            this.calcMarker1.setContent("  ");
            this.calcMarker2.setContent("  ");
            this.spreadMarker1.setStyle({opacity: 0, fillOpacity: 0});
            this.spreadMarker2.setStyle({opacity: 0, fillOpacity: 0});
            this.hundredDamageRadius.setStyle({opacity: 0, fillOpacity: 0});
            this.twentyFiveDamageRadius.setStyle({opacity: 0, fillOpacity: 0});
        }

        if (App.userSettings.targetDrag){ this.posPopUp.openOn(this.map); }
        
        this.miniCircle.setStyle({opacity: 1});
    },

    // Hide stuff, do a final update and send data to API
    _handleDragEnd: function (e) {

        if (App.userSettings.keypadUnderCursor){
            this.map.on("mousemove", this.map._handleMouseMove);
        }

        // Hide PositionPopUp & MiniCircle
        this.isDragging = false;
        this.posPopUp.close();
        this.miniCircle.setStyle({opacity: 0});
        
        // update one last time when drag end
        this.updateCalc();
        this.updateIcon();

        // Report target to squadcalc API if API is configured
        if (process.env.API_URL) {
            sendTargetData({
                lat: e.target.getLatLng().lat,
                lng: e.target.getLatLng().lng,
                weapon: App.activeWeapon.name,
                map: App.minimap.activeMap.name,
            });
        }
    },

    // Delete targetMarker on right clic
    _handleContextMenu: function(){

        // Avoid other target keeping fading
        clearTimeout(this.mouseOverTimeout);

        // If they already faded, switch them back
        this.map.activeTargetsMarkers.eachLayer((target) => {
            target.on("mouseover", target._handleMouseOver, target);
            target.on("mouseout", target._handleMouseOut, target);
            target.setOpacity(1);
            target.calcMarker1.openOn(this.map);
            if (this.map.activeWeaponsMarkers.getLayers()[1]) target.calcMarker2.openOn(this.map);
            target.updateSpread();
            target.updateDamageRadius();
        });

        // We can now safely start deleting
        this.delete();
    },

    // On Hovering for more than 500ms, show a trajectory path and hide other targets
    _handleMouseOver: function() {

        this.mouseOverTimeout = setTimeout(() => {

            // Update & show TrajectoryPath
            this.pathTrajectory1.setLatLngs([this.map.activeWeaponsMarkers.getLayers()[0].getLatLng(), this._latlng]).setStyle({ opacity: 1 });
            if (this.map.activeWeaponsMarkers.getLayers()[1]) {
                this.pathTrajectory2.setLatLngs([this.map.activeWeaponsMarkers.getLayers()[1].getLatLng(), this._latlng]).setStyle({ opacity: 1 });
            }

            // Hide other targets
            if (!this.isDragging && App.userSettings.targetEmphasis){
                this.map.activeTargetsMarkers.eachLayer((target) => {
                    if (target != this) {
                        target.off("mouseover");
                        target.off("mouseout");
                        target.setOpacity(0.65);
                        target.calcMarker1.close();
                        target.calcMarker2.close();
                        target.spreadMarker1.setStyle(this.spreadOptionsOff);
                        target.spreadMarker2.setStyle(this.spreadOptionsOff);
                        target.hundredDamageRadius.setStyle({ opacity: 0 });
                        target.twentyFiveDamageRadius.setStyle({ opacity: 0 });
                    }
                });
            }
        }, 500);
    },

    _handleMouseOut: function() {

        // Cancel the timeout if the user moves the mouse out before 1 second
        clearTimeout(this.mouseOverTimeout);

        this.calcMarker1.getElement().style.zIndex  = "";
        this.calcMarker2.getElement().style.zIndex  = "";

        if (!this.isDragging){
            this.pathTrajectory1.setStyle({ opacity: 0 });
            this.pathTrajectory2.setStyle({ opacity: 0 });
            this.map.activeTargetsMarkers.eachLayer((target) => {
                target.on("mouseover", target._handleMouseOver, target);
                target.on("mouseout", target._handleMouseOut, target);
                target.setOpacity(1);
                target.calcMarker1.openOn(this.map);
                target.calcMarker2.openOn(this.map);
                target.updateCalc();
                target.updateSpread();
                target.updateDamageRadius();
            });
        }
    },

});