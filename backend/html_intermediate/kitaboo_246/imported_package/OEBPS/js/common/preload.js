var checkParentWindow = false;
if(window.parent)
{
	if(window.parent.checkParentWindow)
	{
		checkParentWindow = true;
	}
}
//=============================================================
function InitPreloadImages(_obj)
{
	var curImg = 0;
	if(checkParentWindow)
	{
		window.parent.shellPreloadObj.setTotal(_obj.images.length);
	}
	function loadImage()
	{
		var img = new Image();
		img.onload = imgLoaded;
		img.src = _obj.path+""+_obj.images[curImg];
	}
	function imgLoaded()
	{
		curImg++;
		if(checkParentWindow)
		{
			window.parent.shellPreloadObj.loaded();
		}
		if(curImg < _obj.images.length)
		{
			loadImage();
		}
	}
	
	loadImage();
}