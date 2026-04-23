var BrowserDetect = {
	Android: function() {
		return navigator.userAgent.match(/Android/i) ? true : false;
	},
	BlackBerry: function() {
		return navigator.userAgent.match(/BlackBerry/i) ? true : false;
	},
	iOS: function() {
		return navigator.userAgent.match(/iPhone|iPad|iPod/i) ? true : false;
	},
	Windows: function() {
		return navigator.userAgent.match(/IEMobile/i) ? true : false;
	},
	any: function() {
		return (BrowserDetect.Android() || BrowserDetect.BlackBerry() || BrowserDetect.iOS() || BrowserDetect.Windows());
	},
	ie9: function() {
		return navigator.userAgent.match(/MSIE 9.0/i) ? true : false;
	},
	ie10: function() {
		return navigator.userAgent.match(/MSIE 10.0/i) ? true : false;
	},
	FF: function() {
		return typeof InstallTrigger !== 'undefined';
	}
};
//=============================================================
function TextActionClass()
{
	var totalIndex = 0;
	this.init = function(_origin)
	{
		$(".bodydiv").each(function(index, element) {
			$(this).attr(
			{
				"scaleval": 1,
				"id": "text_"+index
			});
			totalIndex = index;
		});
		//-----------------
		$(".bodydiv").bind("click", onClick);
		//-----------------
		if(typeof(_origin) != "undefined")
		{
			$(".bodydiv").css(
			{
				"-ms-transform-origin": _origin,
				"-webkit-transform-origin": _origin,
				"transform-origin": _origin
			});
		}
	}
	//==========================================
	this.setOrigin = function(_elem, _origin)
	{
		_elem.css(
		{
			"-ms-transform-origin": _origin,
			"-webkit-transform-origin": _origin,
			"transform-origin": _origin
		});
	}
	//==========================================
	function onClick(e)
	{
		if(document.getSelection().toString() == "" || !checkParentWindow)
		{
			var _thisObj = $(this).attr("id");
			$(".bodydiv").each(function(index, element) {
				var scaleval = Number($(this).attr("scaleval"));
				if($(this).attr("id") == _thisObj)
				{
					$(this).animate({scaleval:scaleval}, 1);
					scaleval = scaleval == 1 ? 1.5 : 1;
				}
				else
				{
					$(this).animate({scaleval:scaleval}, 1);
					scaleval = 1;
				}
				if(scaleval == 1)
				{
					$(this).css("z-index", 1);
				}
				else
				{
					$(this).css("z-index", 2);
				}
				$(this).animate({scaleval:scaleval}, {duration:300, step:function(now, tween)
				{
					scaleval = now;
					if($(this).hasClass("author"))
					{
						$(this).css(
						{
							"-ms-transform": "scale("+now+")",
							"-webkit-transform": "scale("+now+")",
							"transform": "scale("+now+")"
						});
					}
					else
					{
						$(this).css(
						{
							"background":"rgba(255, 255, 255, "+(0.5 - (1.5 - now))+")",
							"-ms-transform": "scale("+now+")",
							"-webkit-transform": "scale("+now+")",
							"transform": "scale("+now+")"
						});
					}
				}, complete: function()
				{
					$(this).attr("scaleval", scaleval);
				}
				});
			});
		}
		e.preventDefault();
	}
}
var textAction = new TextActionClass();
//=============================================================
var hotSpotArr = ["-1px -0px", "-57px -0px", "-113px -0px", "-169px -0px", "-225px -0px", "-281px -0px", "-337px -0px", "-393px -0px", "-449px -0px", "-505px -0px", "-561px -0px", "-1px -56px", "-57px -56px", "-113px -56px", "-169px -56px", "-225px -56px", "-281px -56px", "-337px -56px", "-393px -56px", "-449px -56px", "-505px -56px", "-561px -56px", "-1px -112px", "-57px -112px", "-113px -112px", "-169px -112px", "-225px -112px", "-281px -112px", "-337px -112px", "-393px -112px", "-449px -112px", "-505px -112px", "-561px -112px", "-1px -168px", "-57px -168px", "-113px -168px", "-169px -168px", "-225px -168px", "-281px -168px", "-337px -168px", "-393px -168px", "-449px -168px", "-505px -168px", "-561px -168px", "-1px -224px", "-57px -224px", "-113px -224px", "-169px -224px", "-225px -224px", "-281px -224px", "-337px -224px", "-393px -224px", "-449px -224px", "-505px -224px", "-561px -224px", "-1px -280px", "-57px -280px", "-113px -280px", "-169px -280px", "-225px -280px", "-281px -280px", "-337px -280px", "-393px -280px", "-449px -280px", "-505px -280px", "-561px -280px", "-1px -336px", "-57px -336px", "-113px -336px", "-169px -336px", "-225px -336px", "-281px -336px", "-337px -336px", "-393px -336px", "-449px -336px", "-505px -336px", "-561px -336px", "-1px -392px", "-57px -392px", "-113px -392px", "-169px -392px", "-225px -392px", "-281px -392px", "-337px -392px", "-393px -392px", "-449px -392px", "-505px -392px", "-561px -392px", "-1px -448px", "-57px -448px", "-113px -448px", "-169px -448px", "-225px -448px", "-281px -448px", "-337px -448px", "-393px -448px", "-449px -448px", "-505px -448px", "-561px -448px", "-1px -504px", "-57px -504px", "-113px -504px", "-169px -504px", "-225px -504px", "-281px -504px", "-337px -504px", "-393px -504px", "-449px -504px", "-505px -504px", "-561px -504px", "-1px -560px", "-57px -560px", "-113px -560px", "-169px -560px", "-225px -560px", "-281px -560px", "-337px -560px", "-393px -560px", "-449px -560px", "-505px -560px", "-561px -560px", "-1px -616px", "-57px -616px", "-113px -616px", "-169px -616px", "-225px -616px", "-281px -616px", "-337px -616px", "-393px -616px", "-449px -616px", "-505px -616px", "-561px -616px", "-1px -672px", "-57px -672px", "-113px -672px", "-169px -672px", "-225px -672px", "-281px -672px", "-337px -672px", "-393px -672px"];
//=============================================================