var AudioPlayerClass = function()
{
	// Default starts ...
	var p = 
	{
		/*click:{source:"../com/audio/common_audio.mp3"},
		down:{source:"../com/audio/common_down.mp3"},
		up:{source:"../com/audio/common_up.mp3"},
		camera:{source:"../com/audio/snapshot.mp3"},
		confirm:{source:"../com/audio/common_confirm.mp3"}*/
	}
	// Default ends ...
	var _thisObj = this;
	var audioContext;
	var audioObj = new Object();
	var classVolume = true;
	
	var contextBool = false;
	//--------------
	try
	{
		window.AudioContext = window.AudioContext || window.webkitAudioContext;
		audioContext = new AudioContext();
	}
	catch(e)
	{
		contextBool = true;
	}
	//--------------
	if(contextBool)
	{
		for(var i in p)
		{
			audioObj[i] = new Audio();
			audioObj[i].src = p[i].source;
		}
	}
	//--------------
	if(audioContext)
	{
		for(var i in p)
		{
			loadAudio(i, true);
		}
	}
	//================================================================================
	// PUBLIC FUNCTIONS
	//================================================================================
	this.add = function(_type, _path, _cback)
	{
		if(_type.toLowerCase() != "click")
		{
			if(!audioContext)
			{
				audioObj[_type] = new Audio();
				audioObj[_type].src = _path;
				if(typeof(_cback) != undefined)
				{
					audioObj[_type].addEventListener("ended", _cback);
				}
			}
			else
			{
				p[_type] = {source: _path};
				typeof(_cback) != undefined ? p[_type].callBack = _cback : null;
				loadAudio(_type, true);
			}
		}
	}
	//================================================================================
	this.stop = function(_type)
	{
		if(audioContext)
		{
			if(p[_type] && p[_type].context)
			{
				try
				{
					p[_type].context.stop(0);
				}
				catch(e){}
			}
		}
		else
		{
			audioObj[_type] ? audioObj[_type].pause() : null;
		}
	}
	//================================================================================
	this.playAudio = function(_type)
	{
		if(classVolume)
		{
			if(!audioContext)
			{
				if(audioObj[_type])
				{
					if(audioObj[_type].currentTime)
					{
						audioObj[_type].currentTime = 0.01;
					}
					audioObj[_type].play();
				}
			}
			else
			{
				if(p[_type])
				{
					if(!p[_type].buffer)
					{
						loadAudio(_type);
					}
					else
					{
						playAfterLoad(_type)
					}
				}
			}
		}
	}
	//================================================================================
	this.enable = function(_val)
	{
		if(_val != undefined)
		{
			classVolume = _val == 0 ? false : true;
		}
		else
		{
			return classVolume;
		}
	}
	//================================================================================
	// PRIVATE FUNCTIONS
	//================================================================================
	function onError()
	{
		
	}
	//================================================================================
	function loadAudio(_type, _bool)
	{
		var request = new XMLHttpRequest();
		request.open('GET', p[_type].source, true);
		request.responseType = 'arraybuffer';
		// Decode asynchronously
		request.onload = function()
		{
			audioContext.decodeAudioData(request.response, function(buffer) {
				p[_type].buffer = buffer;
				playAfterLoad(_type, _bool);
			}, onError);
		}
		request.send();
	}
	//================================================================================
	function playAfterLoad(_type, _bool)
	{
		p[_type].context = audioContext.createBufferSource();
		typeof(p[_type].callBack) != undefined ? p[_type].context.onended = p[_type].callBack : null;
		p[_type].context.buffer = p[_type].buffer;
		p[_type].context.connect(audioContext.destination);
		_bool ? null : p[_type].context.start(0);
	}
}
var audioPlayerObj = new AudioPlayerClass();