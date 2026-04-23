initPreloadImages = new InitPreloadImages(
{
	images:["bg.png", "eyebrow.png", "flower.png", "girleye.png", "hour.png", "man1eye.png", "man2eye.png", "manhand.png", "minute.png", "moon.png", "specover.png", "star1.png", "star2.png"],
	path:"image/page_2/"
});
//============================================
var moonObj, star1_1Obj, star1_2Obj, star1_3Obj, star1_4Obj, star2Obj, manhandObj, flowerObj, girleyeObj, man1eyeObj, man2eyeObj, eyebrowObj, hs1Obj, hs2Obj, hs3Obj;

var moonArr = ["-2px -0px", "-146px -0px", "-290px -0px", "-434px -0px", "-578px -0px", "-722px -0px", "-866px -0px", "-1010px -0px", "-1154px -0px", "-2px -155px", "-146px -155px", "-290px -155px", "-434px -155px", "-578px -155px", "-722px -155px", "-866px -155px", "-1010px -155px", "-1154px -155px", "-2px -310px", "-146px -310px", "-290px -310px", "-434px -310px", "-578px -310px", "-722px -310px", "-866px -310px", "-1010px -310px", "-1154px -310px", "-2px -465px", "-146px -465px", "-290px -465px", "-434px -465px", "-578px -465px", "-722px -465px", "-866px -465px", "-1010px -465px", "-1154px -465px", "-2px -620px", "-146px -620px", "-290px -620px", "-434px -620px", "-578px -620px", "-722px -620px", "-866px -620px", "-1010px -620px", "-1154px -620px", "-2px -775px", "-146px -775px", "-290px -775px", "-434px -775px", "-578px -775px", "-722px -775px", "-866px -775px", "-1010px -775px", "-1154px -775px", "-2px -930px", "-146px -930px", "-290px -930px", "-434px -930px", "-578px -930px", "-722px -930px", "-866px -930px", "-1010px -930px", "-1154px -930px", "-2px -1085px", "-146px -1085px", "-290px -1085px", "-434px -1085px", "-578px -1085px", "-722px -1085px", "-866px -1085px", "-1010px -1085px", "-1154px -1085px", "-2px -1240px", "-146px -1240px", "-290px -1240px", "-434px -1240px", "-578px -1240px", "-722px -1240px", "-866px -1240px", "-1010px -1240px", "-1154px -1240px", "-2px -1395px", "-146px -1395px", "-290px -1395px"];

var star1Arr = ["-2px -0px", "-58px -0px", "-114px -0px", "-170px -0px", "-226px -0px", "-2px -50px", "-58px -50px", "-114px -50px", "-170px -50px", "-226px -50px", "-2px -100px", "-58px -100px", "-114px -100px", "-170px -100px", "-226px -100px", "-2px -150px", "-58px -150px", "-114px -150px", "-170px -150px", "-226px -150px", "-2px -200px", "-58px -200px", "-114px -200px", "-170px -200px", "-226px -200px"];

var star2Arr = ["-2px -0px", "-58px -0px", "-114px -0px", "-170px -0px", "-226px -0px", "-2px -50px", "-58px -50px", "-114px -50px", "-170px -50px", "-226px -50px", "-2px -100px", "-58px -100px", "-114px -100px", "-170px -100px", "-226px -100px", "-2px -150px", "-58px -150px", "-114px -150px", "-170px -150px", "-226px -150px", "-2px -200px", "-58px -200px", "-114px -200px", "-170px -200px", "-226px -200px"];

var manhandArr = ["-3px -0px", "-54px -0px", "-105px -0px", "-156px -0px", "-207px -0px", "-258px -0px", "-309px -0px", "-3px -222px", "-54px -222px", "-105px -222px", "-156px -222px", "-207px -222px", "-258px -222px", "-309px -222px", "-3px -444px", "-54px -444px", "-105px -444px", "-156px -444px", "-207px -444px", "-258px -444px", "-309px -444px", "-3px -666px", "-54px -666px", "-105px -666px", "-156px -666px", "-207px -666px", "-258px -666px", "-309px -666px", "-3px -888px", "-54px -888px", "-105px -888px", "-156px -888px", "-207px -888px", "-258px -888px", "-309px -888px", "-3px -1110px", "-54px -1110px", "-105px -1110px", "-156px -1110px", "-207px -1110px", "-258px -1110px", "-309px -1110px", "-3px -1332px", "-54px -1332px", "-105px -1332px", "-156px -1332px", "-207px -1332px", "-258px -1332px", "-309px -1332px", "-3px -1554px", "-54px -1554px", "-105px -1554px", "-156px -1554px", "-207px -1554px", "-258px -1554px", "-309px -1554px", "-3px -1776px", "-54px -1776px", "-105px -1776px", "-156px -1776px"];

var flowerArr = ["-3px -0px", "-50px -0px", "-97px -0px", "-144px -0px", "-191px -0px", "-238px -0px", "-285px -0px", "-3px -140px", "-50px -140px", "-97px -140px", "-144px -140px", "-191px -140px", "-238px -140px", "-285px -140px", "-3px -280px", "-50px -280px", "-97px -280px", "-144px -280px", "-191px -280px", "-238px -280px", "-285px -280px", "-3px -420px", "-50px -420px", "-97px -420px", "-144px -420px", "-191px -420px", "-238px -420px", "-285px -420px", "-3px -560px", "-50px -560px", "-97px -560px", "-144px -560px", "-191px -560px", "-238px -560px", "-285px -560px", "-3px -700px", "-50px -700px", "-97px -700px", "-144px -700px", "-191px -700px", "-238px -700px", "-285px -700px", "-3px -840px", "-50px -840px", "-97px -840px", "-144px -840px", "-191px -840px", "-238px -840px", "-285px -840px", "-3px -980px"];

var girleyeArr = ["-2px -0px", "-60px -0px", "-118px -0px", "-176px -0px", "-2px -27px", "-60px -27px", "-118px -27px", "-176px -27px", "-2px -54px", "-60px -54px", "-118px -54px", "-176px -54px", "-2px -81px", "-60px -81px", "-118px -81px", "-176px -81px", "-2px -108px", "-60px -108px", "-118px -108px", "-176px -108px", "-2px -135px", "-60px -135px", "-118px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px", "-176px -135px"];

var man1eyeArr = ["-2px -0px", "-68px -0px", "-134px -0px", "-200px -0px", "-2px -28px", "-68px -28px", "-134px -28px", "-200px -28px", "-2px -56px", "-68px -56px", "-134px -56px", "-200px -56px", "-2px -84px", "-68px -84px", "-134px -84px", "-200px -84px", "-2px -112px", "-68px -112px", "-134px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px", "-200px -112px"];

var man2eyeArr = ["-2px -0px", "-75px -0px", "-148px -0px", "-221px -0px", "-294px -0px", "-2px -30px", "-75px -30px", "-148px -30px", "-221px -30px", "-294px -30px", "-2px -60px", "-75px -60px", "-148px -60px", "-221px -60px", "-294px -60px", "-2px -90px", "-75px -90px", "-148px -90px", "-221px -90px", "-294px -90px", "-2px -120px", "-75px -120px", "-148px -120px", "-221px -120px", "-294px -120px", "-2px -150px", "-75px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px", "-148px -150px"];

var eyebrowArr = ["-2px -0px", "-73px -0px", "-144px -0px", "-215px -0px", "-286px -0px", "-357px -0px", "-428px -0px", "-499px -0px", "-570px -0px", "-641px -0px", "-2px -26px", "-73px -26px", "-144px -26px", "-215px -26px", "-286px -26px", "-357px -26px", "-428px -26px", "-499px -26px", "-570px -26px", "-641px -26px", "-2px -52px", "-73px -52px", "-144px -52px", "-215px -52px", "-286px -52px", "-357px -52px", "-428px -52px", "-499px -52px", "-570px -52px", "-641px -52px", "-2px -78px", "-73px -78px", "-144px -78px", "-215px -78px", "-286px -78px", "-357px -78px", "-428px -78px", "-499px -78px", "-570px -78px", "-641px -78px", "-2px -104px", "-73px -104px", "-144px -104px", "-215px -104px", "-286px -104px", "-357px -104px", "-428px -104px", "-499px -104px", "-570px -104px", "-641px -104px", "-2px -130px", "-73px -130px", "-144px -130px", "-215px -130px", "-286px -130px", "-357px -130px", "-428px -130px", "-499px -130px", "-570px -130px", "-641px -130px", "-2px -156px", "-73px -156px", "-144px -156px", "-215px -156px", "-286px -156px", "-357px -156px", "-428px -156px", "-499px -156px", "-570px -156px", "-641px -156px", "-2px -182px", "-73px -182px", "-144px -182px", "-215px -182px", "-286px -182px", "-357px -182px", "-428px -182px", "-499px -182px", "-570px -182px", "-641px -182px", "-2px -208px", "-73px -208px", "-144px -208px", "-215px -208px", "-286px -208px", "-357px -208px", "-428px -208px", "-499px -208px", "-570px -208px", "-641px -208px", "-2px -234px", "-73px -234px", "-144px -234px", "-215px -234px", "-286px -234px", "-357px -234px", "-428px -234px", "-499px -234px", "-570px -234px", "-641px -234px"];

//=================================================
var audioObj = new Audio();
audioObj.src = "audio/page_2/reloj.mp3";
audioObj.load();
audioObj.addEventListener("ended", onAudioCompleted);
//=================================================
$(document).ready(function(e) {
	moonObj = new AnimationCls();
	moonObj.init($("#moon"), moonArr, allAnimLoaded, "image/page_2/moon.png");
	star1_1Obj = new AnimationCls();
	star1_1Obj.init($("#star1_1"), star1Arr, allAnimLoaded, "image/page_2/star1.png");
	star1_2Obj = new AnimationCls();
	star1_2Obj.init($("#star1_2"), star1Arr, allAnimLoaded, "image/page_2/star1.png");
	star1_3Obj = new AnimationCls();
	star1_3Obj.init($("#star1_3"), star1Arr, allAnimLoaded, "image/page_2/star1.png");
	star1_4Obj = new AnimationCls();
	star1_4Obj.init($("#star1_4"), star1Arr, allAnimLoaded, "image/page_2/star1.png");
	star2Obj = new AnimationCls();
	star2Obj.init($("#star2"), star2Arr, allAnimLoaded, "image/page_2/star2.png");
	manhandObj = new AnimationCls();
	manhandObj.init($("#manhand"), manhandArr, allAnimLoaded, "image/page_2/manhand.png");
	flowerObj = new AnimationCls();
	flowerObj.init($("#flower"), flowerArr, allAnimLoaded, "image/page_2/flower.png");
	girleyeObj = new AnimationCls();
	girleyeObj.init($("#girleye"), girleyeArr, allAnimLoaded, "image/page_2/girleye.png");
	man1eyeObj = new AnimationCls();
	man1eyeObj.init($("#man1eye"), man1eyeArr, allAnimLoaded, "image/page_2/man1eye.png");
	man2eyeObj = new AnimationCls();
	man2eyeObj.init($("#man2eye"), man2eyeArr, allAnimLoaded, "image/page_2/man2eye.png");
	eyebrowObj = new AnimationCls();
	eyebrowObj.init($("#eyebrow"), eyebrowArr, allAnimLoaded, "image/page_2/eyebrow.png");
	//--------------------
	$("#hotspot1,#hotspot2,#hotspot3").sparkle({
		color: ["#FFFFFF","#e2e2e2","#ddcb00"],
		speed: 1,
		minSize:5,
		maxSize:7,
		count:30
	});
	//--------------------
	$("#manclick").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onManhandClick);
	$("#manhand").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onManhandClick);
	$("#specover").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onManhandClick);
	
	$("#womanclick").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onFlowerClick);
	$("#girleye").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onFlowerClick);
	$("#flower").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onFlowerClick);
	
	$("#watch").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onWatchClick);
	//--------------------
	watchCnv = document.getElementById("watch");
	watchCtx = watchCnv.getContext("2d");
	drawWatch();
	//--------------------
	textAction.init();
	//--------------------
	if(!checkParentWindow)
	{
		startAnim();
	}
});
//===========================================
function startAnim()
{
	globalAnimClassObject.start(
	{
		id:"anim_2",
		fps:24,
		frame:onframe_2,
	});
}
function stopAnim()
{
	globalAnimClassObject.stop("anim_2");
}
//===========================================
var loadedCount = 0;
function allAnimLoaded(e)
{
	if(e.type == "animCompleted")
	{
		if(e.target == manhandObj)
		{
			$("#hotspot3").fadeIn(300);
			manhandAnim = false;
		}
		if(e.target == flowerObj)
		{
			$("#hotspot2").fadeIn(300);
			flowerAnim = false;
		}
	}
}
//===========================================
function onframe_2(id)
{
	girleyeObj.updateAnim();
	man1eyeObj.updateAnim();
	man2eyeObj.updateAnim();
	eyebrowObj.updateAnim();
	moonObj.updateAnim();
	star1_1Obj.updateAnim();
	star1_2Obj.updateAnim();
	star1_3Obj.updateAnim();
	star1_4Obj.updateAnim();
	star2Obj.updateAnim();
	//--------
	/*hs1Obj.updateAnim();
	hs2Obj.updateAnim();
	hs3Obj.updateAnim();*/
	//--------
	//----------------
	if(manhandAnim)
	{
		manhandObj.updateAnim();
	}
	if(flowerAnim)
	{
		flowerObj.updateAnim();
	}
	//----------------
}
//===========================================
function onAudioCompleted()
{
	$("#hotspot1").fadeIn(300);
	globalAnimClassObject.stop("watch_2");
}
//===========================================
var manhandAnim = false;
function onManhandClick(e)
{
	$("#hotspot3").fadeOut(300);
	manhandAnim = true;
	e.preventDefault();
}
//===========================================
var flowerAnim = false;
function onFlowerClick(e)
{
	$("#hotspot2").fadeOut(300);
	flowerAnim = true;
	e.preventDefault();
}
//===========================================
function onWatchClick(e)
{
	$("#hotspot1").fadeOut(300);
	audioObj.play();
	globalAnimClassObject.start(
	{
		id:"watch_2",
		delay:250,
		frame:drawWatch,
	});
	e.preventDefault();
}
//===========================================
var watchCnv, watchCtx, watchSec;
var showAct = true;
var watchDate = new Date();
function drawWatch()
{
	if(typeof(watchCnv) != "undefined")
	{
		watchSec = showAct ? watchDate.getSeconds() : watchSec + 0.3;
		showAct = false;
		//----
		//console.log(_min+" + "+_sec);
		watchCnv.width = watchCnv.width;
		watchCtx.save();
		watchCtx.beginPath();
		//watchCtx.lineWidth = 3;
		//watchCtx.strokeStyle = "#000000";
		watchCtx.translate(watchCnv.width / 2, watchCnv.height / 2);
		watchCtx.rotate(dToR((watchDate.getHours() * 360 / 12) % 360));
		watchCtx.translate(-1 * (watchCnv.width / 2), -1 * (watchCnv.height / 2));
		watchCtx.drawImage(hrImg, (watchCnv.width / 2) - 2, 15);
		//watchCtx.moveTo(watchCnv.width / 2, (watchCnv.height / 2) + 5);
		//watchCtx.lineTo(watchCnv.width / 2, 14);
		//watchCtx.stroke();
		watchCtx.restore();
		//----
		watchCtx.save();
		watchCtx.beginPath();
		//watchCtx.lineWidth = 2;
		//watchCtx.strokeStyle = "#000000";
		watchCtx.translate(watchCnv.width / 2, watchCnv.height / 2);
		watchCtx.rotate(dToR((watchDate.getMinutes() * 360 / 60) % 360));
		watchCtx.translate(-1 * (watchCnv.width / 2), -1 * (watchCnv.height / 2));
		watchCtx.drawImage(minImg, (watchCnv.width / 2) - 2, 5);
		//watchCtx.moveTo(watchCnv.width / 2, (watchCnv.height / 2) + 5);
		//watchCtx.lineTo(watchCnv.width / 2, 7);
		//watchCtx.stroke();
		watchCtx.restore();
		//----
		watchCtx.save();
		watchCtx.beginPath();
		watchCtx.lineWidth = 1;
		watchCtx.strokeStyle = "#FF0000";
		watchCtx.translate(watchCnv.width / 2, watchCnv.height / 2);
		watchCtx.rotate(dToR((watchSec * 360 / 60) % 360));
		watchCtx.translate(-1 * (watchCnv.width / 2), -1 * (watchCnv.height / 2));
		watchCtx.moveTo(watchCnv.width / 2, (watchCnv.height / 2) + 5);
		watchCtx.lineTo(watchCnv.width / 2, 5);
		watchCtx.stroke();
		watchCtx.restore();
		//----
	}
}
//===========================================
function dToR(degrees) {
	return (Math.PI / 180) * degrees
}
//===========================================
var hrImg = new Image();
hrImg.onload = onImageLoaded;
hrImg.src = "image/page_2/hour.png";
//----------
var minImg = new Image();
minImg.onload = onImageLoaded;
minImg.src = "image/page_2/minute.png";
//----------
var loadNum = 0;
function onImageLoaded()
{
	loadNum++;
	if(loadNum > 1)
	{
		drawWatch();
	}
}
//===========================================