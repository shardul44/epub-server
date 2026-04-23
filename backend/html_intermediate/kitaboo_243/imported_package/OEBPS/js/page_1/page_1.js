initPreloadImages = new InitPreloadImages(
{
	images:["bg.png", "bigflower.png", "boyeye.png", "chand.png", "cmouth.png", "flower2.png", "girleye.png", "head.png", "maneye.png", "shell.png", "smflower.png"],
	path:"image/page_1/"
});
//============================================
var flowerObj, flower2Obj, smflowerObj, cmouthObj, chandObj, shellObj, girleyeObj, maneyeObj, boyeyeObj, hs1Obj, hs2Obj, hs3Obj;

var bigflowerArr = ["-2px -0px", "-89px -0px", "-176px -0px", "-263px -0px", "-350px -0px", "-437px -0px", "-524px -0px", "-611px -0px", "-2px -87px", "-89px -87px", "-176px -87px", "-263px -87px", "-350px -87px", "-437px -87px", "-524px -87px", "-611px -87px", "-2px -174px", "-89px -174px", "-176px -174px", "-263px -174px", "-350px -174px", "-437px -174px", "-524px -174px", "-611px -174px", "-2px -261px", "-89px -261px", "-176px -261px", "-263px -261px", "-350px -261px", "-437px -261px", "-524px -261px", "-611px -261px", "-2px -348px", "-89px -348px", "-176px -348px", "-263px -348px", "-350px -348px", "-437px -348px", "-524px -348px", "-611px -348px", "-2px -435px", "-89px -435px", "-176px -435px", "-263px -435px", "-350px -435px", "-437px -435px", "-524px -435px", "-611px -435px", "-2px -522px", "-89px -522px", "-176px -522px", "-263px -522px", "-350px -522px", "-437px -522px", "-524px -522px", "-611px -522px", "-2px -609px", "-89px -609px", "-176px -609px", "-263px -609px", "-350px -609px", "-437px -609px", "-524px -609px", "-611px -609px", "-2px -696px", "-89px -696px", "-176px -696px", "-263px -696px", "-350px -696px", "-437px -696px", "-524px -696px", "-611px -696px", "-2px -783px", "-89px -783px"];

var flower2Arr = ["-3px -0px", "-62px -0px", "-121px -0px", "-180px -0px", "-239px -0px", "-298px -0px", "-357px -0px", "-416px -0px", "-475px -0px", "-3px -59px", "-62px -59px", "-121px -59px", "-180px -59px", "-239px -59px", "-298px -59px", "-357px -59px", "-416px -59px", "-475px -59px", "-3px -118px", "-62px -118px", "-121px -118px", "-180px -118px", "-239px -118px", "-298px -118px", "-357px -118px", "-416px -118px", "-475px -118px", "-3px -177px", "-62px -177px", "-121px -177px", "-180px -177px", "-239px -177px", "-298px -177px", "-357px -177px", "-416px -177px", "-475px -177px", "-3px -236px", "-62px -236px", "-121px -236px", "-180px -236px", "-239px -236px", "-298px -236px", "-357px -236px", "-416px -236px", "-475px -236px", "-3px -295px", "-62px -295px", "-121px -295px", "-180px -295px", "-239px -295px", "-298px -295px", "-357px -295px", "-416px -295px", "-475px -295px", "-3px -354px", "-62px -354px", "-121px -354px", "-180px -354px", "-239px -354px", "-298px -354px", "-357px -354px", "-416px -354px", "-475px -354px", "-3px -413px", "-62px -413px", "-121px -413px", "-180px -413px", "-239px -413px", "-298px -413px", "-357px -413px", "-416px -413px", "-475px -413px", "-3px -472px", "-62px -472px", "-121px -472px", "-180px -472px", "-239px -472px", "-298px -472px", "-357px -472px", "-416px -472px", "-475px -472px", "-3px -531px", "-62px -531px", "-121px -531px", "-180px -531px", "-239px -531px", "-298px -531px", "-357px -531px", "-416px -531px", "-475px -531px", "-3px -590px", "-62px -590px"];

var smflowerArr = ["-3px -0px", "-52px -0px", "-101px -0px", "-150px -0px", "-199px -0px", "-3px -49px", "-52px -49px", "-101px -49px", "-150px -49px", "-199px -49px", "-3px -98px", "-52px -98px", "-101px -98px", "-150px -98px", "-199px -98px", "-3px -147px", "-52px -147px", "-101px -147px", "-150px -147px", "-199px -147px", "-3px -196px", "-52px -196px", "-101px -196px", "-150px -196px", "-199px -196px", "-3px -245px", "-52px -245px", "-101px -245px", "-150px -245px", "-199px -245px"];

var cmouthArr = ["-3px -0px", "-61px -0px", "-119px -0px", "-177px -0px", "-235px -0px", "-293px -0px", "-351px -0px", "-3px -29px", "-61px -29px", "-119px -29px", "-177px -29px", "-235px -29px", "-293px -29px", "-351px -29px", "-3px -58px", "-61px -58px", "-119px -58px", "-177px -58px", "-235px -58px", "-293px -58px", "-351px -58px", "-3px -87px", "-61px -87px", "-119px -87px", "-177px -87px", "-235px -87px", "-293px -87px", "-351px -87px", "-3px -116px", "-61px -116px", "-119px -116px", "-177px -116px", "-235px -116px", "-293px -116px", "-351px -116px", "-3px -145px", "-61px -145px", "-119px -145px", "-177px -145px", "-235px -145px", "-293px -145px", "-351px -145px", "-3px -174px", "-61px -174px", "-119px -174px", "-177px -174px", "-235px -174px", "-293px -174px", "-351px -174px"];

var chandArr = ["-3px -0px", "-222px -0px", "-441px -0px", "-660px -0px", "-879px -0px", "-1098px -0px", "-1317px -0px", "-3px -198px", "-222px -198px", "-441px -198px", "-660px -198px", "-879px -198px", "-1098px -198px", "-1317px -198px", "-3px -396px", "-222px -396px", "-441px -396px", "-660px -396px", "-879px -396px", "-1098px -396px", "-1317px -396px", "-3px -594px", "-222px -594px", "-441px -594px", "-660px -594px", "-879px -594px", "-1098px -594px", "-1317px -594px", "-3px -792px", "-222px -792px", "-441px -792px", "-660px -792px", "-879px -792px", "-1098px -792px", "-1317px -792px", "-3px -990px", "-222px -990px", "-441px -990px", "-660px -990px", "-879px -990px", "-1098px -990px", "-1317px -990px", "-3px -1188px", "-222px -1188px", "-441px -1188px", "-660px -1188px", "-879px -1188px", "-1098px -1188px", "-1317px -1188px", "-3px -1386px", "-222px -1386px", "-441px -1386px", "-660px -1386px", "-879px -1386px", "-1098px -1386px", "-1317px -1386px", "-3px -1584px", "-222px -1584px", "-441px -1584px", "-660px -1584px"];

var shellArr = ["-3px -0px", "-86px -0px", "-169px -0px", "-252px -0px", "-335px -0px", "-418px -0px", "-501px -0px", "-584px -0px", "-3px -70px", "-86px -70px", "-169px -70px", "-252px -70px", "-335px -70px", "-418px -70px", "-501px -70px", "-584px -70px", "-3px -140px", "-86px -140px", "-169px -140px", "-252px -140px", "-335px -140px", "-418px -140px", "-501px -140px", "-584px -140px", "-3px -210px", "-86px -210px", "-169px -210px", "-252px -210px", "-335px -210px", "-418px -210px", "-501px -210px", "-584px -210px", "-3px -280px", "-86px -280px", "-169px -280px", "-252px -280px", "-335px -280px", "-418px -280px", "-501px -280px", "-584px -280px", "-3px -350px", "-86px -350px", "-169px -350px", "-252px -350px", "-335px -350px", "-418px -350px", "-501px -350px", "-584px -350px", "-3px -420px", "-86px -420px", "-169px -420px", "-252px -420px", "-335px -420px", "-418px -420px", "-501px -420px", "-584px -420px", "-3px -490px", "-86px -490px", "-169px -490px", "-252px -490px", "-335px -490px", "-418px -490px", "-501px -490px", "-584px -490px", "-3px -560px"];

var girleyeArr = ["-2px -0px", "-58px -0px", "-114px -0px", "-170px -0px", "-226px -0px", "-282px -0px", "-338px -0px", "-2px -35px", "-58px -35px", "-114px -35px", "-170px -35px", "-226px -35px", "-282px -35px", "-338px -35px", "-2px -70px", "-58px -70px", "-114px -70px", "-170px -70px", "-226px -70px", "-282px -70px", "-338px -70px", "-2px -105px", "-58px -105px", "-114px -105px", "-170px -105px", "-226px -105px", "-282px -105px", "-338px -105px", "-2px -140px", "-58px -140px", "-114px -140px", "-170px -140px", "-226px -140px", "-282px -140px", "-338px -140px", "-2px -175px", "-58px -175px", "-114px -175px", "-170px -175px", "-226px -175px", "-282px -175px", "-338px -175px", "-2px -210px", "-58px -210px", "-114px -210px", "-170px -210px", "-226px -210px", "-282px -210px", "-338px -210px", "-2px -245px"];

var maneyeArr = ["-2px -0px", "-80px -0px", "-158px -0px", "-236px -0px", "-2px -15px", "-80px -15px", "-158px -15px", "-236px -15px", "-2px -30px", "-80px -30px", "-158px -30px", "-236px -30px", "-2px -45px", "-80px -45px", "-158px -45px", "-236px -45px", "-2px -60px", "-80px -60px", "-158px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px", "-236px -60px"];

var boyeyeArr = ["-2px -0px", "-66px -0px", "-130px -0px", "-194px -0px", "-2px -46px", "-66px -46px", "-130px -46px", "-194px -46px", "-2px -92px", "-66px -92px", "-130px -92px", "-194px -92px", "-2px -138px", "-66px -138px", "-130px -138px", "-194px -138px", "-2px -184px", "-66px -184px", "-130px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px", "-194px -184px"];

//==========================================================
$(document).ready(function(e) {
	flowerObj = new AnimationCls();
	flowerObj.init($("#flower"), bigflowerArr, allAnimLoaded, "image/page_1/bigflower.png");
	flower2Obj = new AnimationCls();
	flower2Obj.init($("#flower2"), flower2Arr, allAnimLoaded, "image/page_1/flower2.png");
	smflowerObj = new AnimationCls();
	smflowerObj.init($("#smflower"), smflowerArr, allAnimLoaded, "image/page_1/smflower.png");
	cmouthObj = new AnimationCls();
	cmouthObj.init($("#cmouth"), cmouthArr, allAnimLoaded, "image/page_1/cmouth.png");
	chandObj = new AnimationCls();
	chandObj.init($("#chand"), chandArr, allAnimLoaded, "image/page_1/chand.png");
	shellObj = new AnimationCls();
	shellObj.init($("#shell"), shellArr, allAnimLoaded, "image/page_1/shell.png");
	girleyeObj = new AnimationCls();
	girleyeObj.init($("#girleye"), girleyeArr, allAnimLoaded, "image/page_1/girleye.png");
	maneyeObj = new AnimationCls();
	maneyeObj.init($("#maneye"), maneyeArr, allAnimLoaded, "image/page_1/maneye.png");
	boyeyeObj = new AnimationCls();
	boyeyeObj.init($("#boyeye"), boyeyeArr, allAnimLoaded, "image/page_1/boyeye.png");
	//--------------------
	$("#hotspot1,#hotspot2,#hotspot3").sparkle({
		color: ["#FFFFFF","#e2e2e2","#ddcb00"],
		speed: 1,
		minSize:5,
		maxSize:7,
		count:30
	});
	//--------------------
	$("#girlhead").css(
	{
		"-ms-transform-origin": "103px 172px",
		"-webkit-transform-origin": "103px 172px",
		"transform-origin": "103px 172px"
	});
	$("#girlhead").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onHeadClick);
	$("#cmouth").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onCookClick);
	$("#chand").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onCookClick);
	$("#shell").bind(BrowserDetect.any() ? "touchstart" : "mousedown", onShellClick);
	//--------------------
	textAction.init();
	textAction.setOrigin($(".author"), "left bottom");
	//--------------------
	if(!checkParentWindow)
	{
		startAnim();
	}
	//--------------------
});
//===========================================
function startAnim()
{
	globalAnimClassObject.start(
	{
		id:"anim_1",
		fps:24,
		frame:onframe_1,
	});
}
function stopAnim()
{
	globalAnimClassObject.stop("anim_1");
}
//===========================================
var loadedCount = 0;
function allAnimLoaded(e)
{
	//---------------
	if(e.type == "animCompleted")
	{
		if(e.target == chandObj)
		{
			$("#hotspot1").fadeIn(300);
			chandAnim = false;
		}
		if(e.target == cmouthObj)
		{
			cmouthAnim = false;
		}
		if(e.target == shellObj)
		{
			$("#hotspot3").fadeIn(300);
			shellAnim = false;
		}
	}
}
//===========================================
function onframe_1(id)
{
	flowerObj.updateAnim();
	flower2Obj.updateAnim();
	girleyeObj.updateAnim();
	maneyeObj.updateAnim();
	boyeyeObj.updateAnim();
	//--------
	/*hs1Obj.updateAnim();
	hs2Obj.updateAnim();
	hs3Obj.updateAnim();*/
	//--------
	if(headAnim)
	{
		smflowerObj.updateAnim();
		$("#girlhead").css(
		{
			"-ms-transform": "rotate("+headRot+"deg)",
			"-webkit-transform": "rotate("+headRot+"deg)",
			"transform": "rotate("+headRot+"deg)"
		});
		//----------------
		if(headMoveleft)
		{
			headRot-=0.5;
			if(headRot < -10)
			{
				headMoveleft = false;
			}
		}
		else
		{
			headRot+=0.5;
			if(headRot > 0)
			{
				$("#hotspot2").fadeIn(300);
				headAnim = false
				headMoveleft = true;
			}
		}
	}
	//----------------
	if(cmouthAnim)
	{
		cmouthObj.updateAnim();
	}
	if(chandAnim)
	{
		chandObj.updateAnim();
	}
	//----------------
	if(shellAnim)
	{
		shellObj.updateAnim();
	}
}
//===========================================
var headAnim = false;
var headMoveleft = true;
var headRot = 0;
function onHeadClick(e)
{
	$("#hotspot2").fadeOut(300);
	headAnim = true;
	headMoveleft = true;
	e.preventDefault();
}
//===========================================
var cmouthAnim = false;
var chandAnim = false;
function onCookClick(e)
{
	$("#hotspot1").fadeOut(300);
	cmouthAnim = true;
	chandAnim = true;
	e.preventDefault();
}
//===========================================
var shellAnim = false;
function onShellClick(e)
{
	$("#hotspot3").fadeOut(300);
	shellAnim = true;
	e.preventDefault();
}
//===========================================