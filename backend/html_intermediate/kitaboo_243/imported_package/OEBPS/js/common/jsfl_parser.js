var AnimationCls = function()
{
	var target, canvas, context, imageArray, callback;
	var curImg = 0;
	var _thisObj = this;
	var imgObj = new Image();
	imgObj.onload = imageLoaded;
	imgObj.onerror = imageError;
	this.init = function(_target, _arr, _callback, _img)
	{
		target = _target;
		canvas = document.createElement("canvas");
		context = canvas.getContext("2d");
		canvas.width = parseInt(target.css("width"));
		canvas.height = parseInt(target.css("height"));
		target.append(canvas);
		//------
		imgObj.src = _img;
		//------
		target.css("background", "none");
		//------
		imageArray = _arr;
		callback = _callback;
		//------
		drawCanvas();
	}
	this.updateAnim = function(_frame)
	{
		drawCanvas();
	}
	//=======================================
	function drawCanvas()
	{
		/*target.css("background-position", imageArray[curImg]);*/
		var _x = parseInt(imageArray[curImg].split(" ")[0]);
		var _y = parseInt(imageArray[curImg].split(" ")[1]);
		canvas.width = canvas.width;
		try
		{
			context.drawImage(imgObj, _x, _y);
		}catch(e){}
		curImg++;
		if(curImg == imageArray.length)
		{
			curImg = 0;
			triggerCallBack("animCompleted");
		}
	}
	//=======================================
	function triggerCallBack(_str)
	{
		callback != undefined ? callback({type:_str, target:_thisObj}) : null;
	}
	//=======================================
	function imageLoaded()
	{
		triggerCallBack("imageLoaded");
		drawCanvas();
	}
	//=======================================
	function imageError()
	{
		console.log("imageError = "+imgObj.src);
	}
}