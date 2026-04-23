// GlobalAnimClass is accepts objects
// id: Required to stop the particular animation.
// fps (optional): Frame per second.
// delay (optional): if delay given then fps will not work.
// start (optional): Callback when the animation starts.
// frame (optional): Callback when the animation is playing.
// stop (optional): Callback when the animation stops.
//================================================================================
var GlobalAnimClass = function()
{
    var animObjects = new Object();
    var _thisObj = this;
	var animPlaying = false;
	var requestId;
	//================================================================
    this.start = function(_obj)
	{
		if(_obj.id)
		{
			animObjects[_obj.id] = _obj;
			if(!_obj.immediate)
			{
				animObjects[_obj.id].oldDate = new Date();
			}
			animObjects[_obj.id].start ? animObjects[_obj.id].start() : null;
		}
        if(!animPlaying)
		{
			animPlaying = true;
			enterFrame();
		}
    }
	//================================================================
    this.stop = function(_id)
	{
		if (_id)
		{
			if(animObjects[_id])
			{
				animObjects[_id].stop ? animObjects[_id].stop() : null;
				animObjects[_id] != undefined ? delete animObjects[_id] : null;
			}
		}
		if(objectSize(animObjects) == 0)
		{
			animPlaying = false;
			cancelAnimationFrame(requestId);
		}
    }
	//================================================================
    function enterFrame()
	{
        var _newDate = new Date();
        //--------------------------
		for(var i in animObjects)
		{
			if(animObjects[i].delay != undefined)
			{
				if(typeof(animObjects[i].oldDate) == "undefined" || (_newDate - animObjects[i].oldDate) >= animObjects[i].delay)
				{
					animObjects[i].oldDate = _newDate;
					animObjects[i].frame ? animObjects[i].frame(i) : null;
				}
			}
			else if(animObjects[i].fps != undefined)
			{
				if(typeof(animObjects[i].oldDate) == "undefined" || _newDate - animObjects[i].oldDate >= (1000/animObjects[i].fps))
				{
					animObjects[i].oldDate = _newDate;
					animObjects[i].frame ? animObjects[i].frame(i) : null;
				}
			}
		}
		//--------------------------
		if(animPlaying)
		{
        	requestId = requestAnimationFrame(enterFrame);
		}
    }
	//================================================================
	function objectSize(obj)
	{
		var size = 0, key;
		for (key in obj)
		{
			if (obj.hasOwnProperty(key)) size++;
		}
		return size;
	};
	//================================================================
	//================================================================
	(function()
	{
		var lastTime = 0;
		var vendors = ['webkit', 'moz'];
		for (var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x)
		{
			window.requestAnimationFrame = window[vendors[x] + 'RequestAnimationFrame'];
			window.cancelAnimationFrame = window[vendors[x] + 'CancelAnimationFrame'] || window[vendors[x] + 'CancelRequestAnimationFrame'];
		}
		if (!window.requestAnimationFrame) window.requestAnimationFrame = function(callback, element)
		{
			var currTime = new Date().getTime();
			var timeToCall = Math.max(0, 16 - (currTime - lastTime));
			var id = window.setTimeout(function()
			{
				callback(currTime + timeToCall);
			}, timeToCall);
			lastTime = currTime + timeToCall;
			return id;
		};
		if (!window.cancelAnimationFrame) window.cancelAnimationFrame = function(id)
		{
			clearTimeout(id);
		};
	}());
	//================================================================
	//================================================================
}
var globalAnimClassObject = new GlobalAnimClass();
//================================================================
var globalResizeCalc = function(_obj)
{
	return parseFloat(_obj);
}