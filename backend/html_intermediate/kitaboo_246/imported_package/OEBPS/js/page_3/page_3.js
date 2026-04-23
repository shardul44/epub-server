initPreloadImages = new InitPreloadImages(
{
	images:["earth.png", "eyetop.png", "hand.png", "petals.png", "smile.png", "smoke.png", "bg.png"],
	path:"image/page_3/"
});
//============================================
var eyetopObj, smileObj, smokeObj, petalsObj, earthObj, hs1Obj, hs2Obj, hs3Obj;

var eyetopArr = ["-2px -0px", "-58px -0px", "-114px -0px", "-170px -0px", "-226px -0px", "-2px -15px", "-58px -15px", "-114px -15px", "-170px -15px", "-226px -15px", "-2px -30px", "-58px -30px", "-114px -30px", "-170px -30px", "-226px -30px", "-2px -45px", "-58px -45px", "-114px -45px", "-170px -45px", "-226px -45px", "-2px -60px", "-58px -60px", "-114px -60px", "-170px -60px", "-226px -60px", "-2px -75px", "-58px -75px", "-114px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px", "-170px -75px"];

var smileArr = ["-2px -0px", "-132px -0px", "-262px -0px", "-392px -0px", "-522px -0px", "-652px -0px", "-782px -0px", "-2px -75px", "-132px -75px", "-262px -75px", "-392px -75px", "-522px -75px", "-652px -75px", "-782px -75px", "-2px -150px", "-132px -150px", "-262px -150px", "-392px -150px", "-522px -150px", "-652px -150px", "-782px -150px", "-2px -225px", "-132px -225px", "-262px -225px", "-392px -225px", "-522px -225px", "-652px -225px", "-782px -225px", "-2px -300px", "-132px -300px", "-262px -300px", "-392px -300px", "-522px -300px", "-652px -300px", "-782px -300px", "-2px -375px", "-132px -375px", "-262px -375px", "-392px -375px", "-522px -375px", "-652px -375px", "-782px -375px", "-2px -450px", "-132px -450px", "-262px -450px", "-392px -450px", "-522px -450px", "-652px -450px", "-782px -450px", "-2px -525px", "-132px -525px", "-262px -525px", "-392px -525px", "-522px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px", "-652px -525px"];

var smokeArr = ["-2px -0px", "-58px -0px", "-114px -0px", "-170px -0px", "-226px -0px", "-282px -0px", "-338px -0px", "-394px -0px", "-450px -0px", "-506px -0px", "-562px -0px", "-618px -0px", "-2px -149px", "-58px -149px", "-114px -149px", "-170px -149px", "-226px -149px", "-282px -149px", "-338px -149px", "-394px -149px", "-450px -149px", "-506px -149px", "-562px -149px", "-618px -149px", "-2px -298px", "-58px -298px", "-114px -298px", "-170px -298px", "-226px -298px", "-282px -298px", "-338px -298px", "-394px -298px", "-450px -298px", "-506px -298px", "-562px -298px", "-618px -298px", "-2px -447px", "-58px -447px", "-114px -447px", "-170px -447px", "-226px -447px", "-282px -447px", "-338px -447px", "-394px -447px", "-450px -447px", "-506px -447px", "-562px -447px", "-618px -447px", "-2px -596px", "-58px -596px", "-114px -596px", "-170px -596px", "-226px -596px", "-282px -596px", "-338px -596px", "-394px -596px", "-450px -596px", "-506px -596px", "-562px -596px", "-618px -596px", "-2px -745px", "-58px -745px", "-114px -745px", "-170px -745px", "-226px -745px", "-282px -745px", "-338px -745px", "-394px -745px", "-450px -745px", "-506px -745px", "-562px -745px", "-618px -745px", "-2px -894px", "-58px -894px", "-114px -894px", "-170px -894px", "-226px -894px", "-282px -894px", "-338px -894px", "-394px -894px", "-450px -894px", "-506px -894px", "-562px -894px", "-618px -894px", "-2px -1043px", "-58px -1043px", "-114px -1043px", "-170px -1043px", "-226px -1043px", "-282px -1043px", "-338px -1043px", "-394px -1043px", "-450px -1043px", "-506px -1043px", "-562px -1043px", "-618px -1043px", "-2px -1192px", "-58px -1192px", "-114px -1192px", "-170px -1192px", "-226px -1192px", "-282px -1192px", "-338px -1192px", "-394px -1192px", "-450px -1192px", "-506px -1192px", "-562px -1192px", "-618px -1192px", "-2px -1341px", "-58px -1341px", "-114px -1341px", "-170px -1341px", "-226px -1341px", "-282px -1341px", "-338px -1341px", "-394px -1341px", "-450px -1341px", "-506px -1341px", "-562px -1341px", "-618px -1341px", "-2px -1490px", "-58px -1490px", "-114px -1490px", "-170px -1490px", "-226px -1490px", "-282px -1490px", "-338px -1490px", "-394px -1490px", "-450px -1490px", "-506px -1490px", "-562px -1490px", "-618px -1490px", "-2px -1639px", "-58px -1639px", "-114px -1639px", "-170px -1639px", "-226px -1639px", "-282px -1639px", "-338px -1639px", "-394px -1639px", "-450px -1639px", "-506px -1639px", "-562px -1639px", "-618px -1639px", "-2px -1788px", "-58px -1788px", "-114px -1788px", "-170px -1788px", "-226px -1788px", "-282px -1788px"];

var petalsArr = ["-2px -0px", "-289px -0px", "-576px -0px", "-863px -0px", "-1150px -0px", "-1437px -0px", "-1724px -0px", "-2011px -0px", "-2px -207px", "-289px -207px", "-576px -207px", "-863px -207px", "-1150px -207px", "-1437px -207px", "-1724px -207px", "-2011px -207px", "-2px -414px", "-289px -414px", "-576px -414px", "-863px -414px", "-1150px -414px", "-1437px -414px", "-1724px -414px", "-2011px -414px", "-2px -621px", "-289px -621px", "-576px -621px", "-863px -621px", "-1150px -621px", "-1437px -621px", "-1724px -621px", "-2011px -621px", "-2px -828px", "-289px -828px", "-576px -828px", "-863px -828px", "-1150px -828px", "-1437px -828px", "-1724px -828px", "-2011px -828px", "-2px -1035px", "-289px -1035px", "-576px -1035px", "-863px -1035px", "-1150px -1035px", "-1437px -1035px", "-1724px -1035px", "-2011px -1035px", "-2px -1242px", "-289px -1242px", "-576px -1242px", "-863px -1242px", "-1150px -1242px", "-1437px -1242px", "-1724px -1242px", "-2011px -1242px", "-2px -1449px", "-289px -1449px", "-576px -1449px", "-863px -1449px", "-1150px -1449px", "-1437px -1449px", "-1724px -1449px", "-2011px -1449px", "-2px -1656px", "-289px -1656px", "-576px -1656px", "-863px -1656px", "-1150px -1656px", "-1437px -1656px", "-1724px -1656px", "-2011px -1656px", "-2px -1863px", "-289px -1863px", "-576px -1863px", "-863px -1863px"];

var earthArr = ["-3px -0px", "-130px -0px", "-257px -0px", "-384px -0px", "-511px -0px", "-638px -0px", "-765px -0px", "-3px -225px", "-130px -225px", "-257px -225px", "-384px -225px", "-511px -225px", "-638px -225px", "-765px -225px", "-3px -450px", "-130px -450px", "-257px -450px", "-384px -450px", "-511px -450px", "-638px -450px", "-765px -450px", "-3px -675px", "-130px -675px", "-257px -675px", "-384px -675px", "-511px -675px", "-638px -675px", "-765px -675px", "-3px -900px", "-130px -900px", "-257px -900px", "-384px -900px", "-511px -900px", "-638px -900px", "-765px -900px", "-3px -1125px", "-130px -1125px", "-257px -1125px", "-384px -1125px", "-511px -1125px", "-638px -1125px", "-765px -1125px", "-3px -1350px", "-130px -1350px", "-257px -1350px", "-384px -1350px", "-511px -1350px", "-638px -1350px", "-765px -1350px", "-3px -1575px", "-130px -1575px", "-257px -1575px", "-384px -1575px", "-511px -1575px", "-638px -1575px", "-765px -1575px", "-3px -1800px", "-130px -1800px", "-257px -1800px", "-384px -1800px"];

$(document).ready(function(e) {
	eyetopObj = new AnimationCls();
	eyetopObj.init($("#eyetop"), eyetopArr, allAnimLoaded, "image/page_3/eyetop.png");
	smileObj = new AnimationCls();
	smileObj.init($("#smile"), smileArr, allAnimLoaded, "image/page_3/smile.png");
	smokeObj = new AnimationCls();
	smokeObj.init($("#smoke"), smokeArr, allAnimLoaded, "image/page_3/smoke.png");
	petalsObj = new AnimationCls();
	petalsObj.init($("#petals"), petalsArr, allAnimLoaded, "image/page_3/petals.png");
	earthObj = new AnimationCls();
	earthObj.init($("#earth"), earthArr, allAnimLoaded, "image/page_3/earth.png");
	//--------------------
	$("#hotspot1,#hotspot2,#hotspot3").sparkle({
		color: ["#FFFFFF","#e2e2e2","#ddcb00"],
		speed: 1,
		minSize:5,
		maxSize:7,
		count:30
	});
	//-----------------
	$("#petalclick").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onPetalClick);
	$("#earthclick").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onEarthClick);
	$("#boyclick").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onBoyClick);
	//-----------------
	textAction.init("left center");
	textAction.setOrigin($(".disclaim"), "right bottom");
	//-----------------
	if(!checkParentWindow)
	{
		startAnim();
	}
	//-----------------
	$(".outlink").bind("click", function(e)
	{
		window.open("http://www.schavelzon.com", "_blank");
	});
});
//===========================================
function startAnim()
{
	globalAnimClassObject.start(
	{
		id:"anim_3",
		fps:24,
		frame:onframe_3,
	});
}
function stopAnim()
{
	globalAnimClassObject.stop("anim_3");
}
//=================================================
var audioObj = new Audio();
audioObj.src = "audio/page_3/viento.mp3";
audioObj.load();
audioObj.addEventListener("ended", onAudioCompleted);
//===========================================
var loadedCount = 0;
function allAnimLoaded(e)
{
	if(e.type == "animCompleted")
	{
		if(e.target == smileObj)
		{
			$("#hotspot3").fadeIn(300);
			boyAnim = false;
		}
		if(e.target == petalsObj)
		{
			$("#hotspot1").fadeIn(300);
			petalAnim = false;
		}
	}
}
//===========================================
function onframe_3(id)
{
	/*hs1Obj.updateAnim();
	hs2Obj.updateAnim();
	hs3Obj.updateAnim();*/
	//--------
	eyetopObj.updateAnim();
	boyAnim ? smileObj.updateAnim() : null;
	smokeObj.updateAnim();
	petalAnim ? petalsObj.updateAnim() : null;
	earthAnim ? earthObj.updateAnim() : null;
}
//===========================================
function onAudioCompleted()
{
	$("#hotspot2").fadeIn(300);
	earthAnim = false;
}
//===========================================
var petalAnim = false;
function onPetalClick(e)
{
	$("#hotspot1").fadeOut(300);
	petalAnim = true;
	e.preventDefault();
}
//===========================================
var earthAnim = false;
function onEarthClick(e)
{
	$("#hotspot2").fadeOut(300);
	audioObj.play();
	earthAnim = true;
	e.preventDefault();
}
//===========================================
var boyAnim = false;
function onBoyClick(e)
{
	$("#hotspot3").fadeOut(300);
	boyAnim = true;
	e.preventDefault();
}
//===========================================