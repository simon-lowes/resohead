IRON = window.IRON || {};
(function ($) {
  /*===============================================================================
  ##### This file is available in both MP3 Audio Player Settings and Frontend #####
  ===============================================================================*/

  IRON.peaksCache = {}; // Cache peaks to avoid fetching them multiple times
  var loadFakeWaveOnly;

  IRON.init_generatePeaks = function (player = false){
    if (loadFakeWaveOnly) return;

    if(player && player.stickyPlayer){
      return;
    }

    var peakFile = false;

    if( player && typeof player.currentTrack != 'undefined'){
      peakFile = player.list.tracks[player.currentTrack].peakFile;
    }else{
      peakFile = IRON.sonaar.player.list.tracks[IRON.sonaar.player.currentTrack].peakFile;
    }
    
    if (!peakFile) {
      let audioSource = player ? player : IRON.sonaar.player;

      if (audioSource) {
        let currentTrack = audioSource.list.tracks[audioSource.currentTrack];
        if (currentTrack) {
            if (currentTrack.peak_allow_frontend) {
              IRON.generatePeaks([{
                "file": currentTrack.mp3,
                "post_id": currentTrack.sourcePostID,
                "media_id": currentTrack.id,
                "index": currentTrack.track_pos,
                "is_preview": currentTrack.isPreview,
                "peak_file_type": currentTrack.peak_allow_frontend,
              }]);
            }
        }
      }
    }
  }

  IRON.generatePeaks = async function(files) {    
    // Base condition to stop recursion
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    console.log('We are generating the soundwave ...');

    const file = files[0];

    try {
      const MAX_SIZE    = 200 * 1024 * 1024; // 10MB in bytes
      const response 		= await fetch(file.file);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const contentLength = response.headers.get('Content-Length');
      const fileSizeMB    = parseInt(contentLength, 10) / (1024 * 1024);

      if (!isFirefox() && contentLength && parseInt(contentLength, 10) > MAX_SIZE) {
          // This will return false if contentLength is NaN
          console.log(`File is too large ( > 200MB) to generate waveform in this browser. Use Firefox to generate it for the first time. (${fileSizeMB.toFixed(2)} MB). Skipping: ${file.file}`);
          return; // Skip this file
      }

      console.log(`File is ${fileSizeMB.toFixed(2)} MB. Analyzing waveform of: ${file.file}`);
      const arrayBuffer 	= await response.arrayBuffer();
      try {

        var audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        let peaks 		  = IRON.extractPeaks(audioBuffer);
        IRON.updatePeaksOnServer(file.post_id, file.media_id, file.index, peaks, file.file, file.is_temp, file.is_preview, file.peak_file_type);
        // Attempt to release the audioBuffer memory
        audioBuffer = null;

      } catch (decodeError) {
        console.error('Error decoding file:', file.file, decodeError);
      }
    } catch (fetchError) {
      console.error('Error fetching file:', file.file, fetchError);
    }

    function isFirefox() {
      return navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
    }

  }

  IRON.extractPeaks = function(audioBuffer, peakLength = 1920) {
    const channels    = audioBuffer.numberOfChannels;
    const sampleSize  = audioBuffer.length / peakLength;
    const sampleStep  = ~~(sampleSize / 10) || 1;
    const peaks       = [];

    for (let c = 0; c < channels; c++) {
      const chan = audioBuffer.getChannelData(c);

      for (let i = 0; i < peakLength; i++) {
        let start   = ~~(i * sampleSize);
        let end     = ~~(start + sampleSize);
        let min     = chan[0];
        let max     = chan[0];

        for (let j = start; j < end; j += sampleStep) {
          const value = chan[j];
          if (value > max) max = value;
          if (value < min) min = value;
        }
        
        if (c === 0 || max > peaks[2 * i]) {
          peaks[2 * i] = Math.abs(max.toFixed(2));
        }
        if (c === 0 || min < peaks[2 * i + 1]) {
          peaks[2 * i + 1] = Math.abs(min.toFixed(2));
        }
      }
    }
    return peaks;
  }
  
  IRON.updatePeaksOnServer = function(postId, media_id, index, peaks, file = null, is_temp = null, is_preview = null, peak_file_type = null) {
    peaks = peaks.join(',').replace(/0\./gi,'.')
    $.ajax({
      url: sonaar_music.ajax.ajax_url,
      type: 'POST',
      dataType: 'json',
      data: {
        action: 'update_audio_peaks',
        nonce: sonaar_music.ajax.ajax_nonce_peaks,
        post_id: postId,
        media_id: media_id,
        index: index,
        file: file,
        peaks: peaks,
        is_temp: is_temp,
        is_preview: is_preview,
        peak_file_type: peak_file_type,
      },
      success: function(response) {
        console.log('Peaks updated for media_id:', media_id, ' post_id:', postId, 'index:', index, response);
      },
      error: function(jqXHR, textStatus, errorThrown) {
        console.error("Error updating peaks: ", textStatus, errorThrown);
      }
    });
  }
  IRON.addDownloadSVGButton = function() {
    IRON.addDownloadSVGButton.saveSVG = true;

    var btn = document.createElement("button");
    btn.innerHTML = "Download SVG";
    btn.style.position = "absolute";
    btn.style.top = "50px";
    btn.style.left = "50px";
    btn.style.zIndex = "9999";

    btn.onclick = function() {
        downloadSVG(IRON.addDownloadSVGButton.svgString);
    };
    document.body.prepend(btn);

    function downloadSVG(svgData) {
      var blob = new Blob([svgData], { type: 'image/svg+xml' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'soundwave.svg';
      document.body.appendChild(a);
      a.click();
      setTimeout(function() {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);  
      }, 0);
    }

  }
  createFakeWave = function (audioPlayer = true, imSticky = false, singleTrack = false) {
    if(!imSticky && !singleTrack && audioPlayer.remove_wave) return;

    if(sonaar_music.option.music_player_load_fakewave_only == 'on') loadFakeWaveOnly = true;
    
    if (imSticky && sonaar_music.option.sticky_spectro_container == 'inside' && sonaar_music.option.sticky_spectro_style != 'none') {
      return; // Early return if specific conditions are met
    }

    var waveId;
    if(singleTrack && singleTrack.index() < 20){ // for better performance, only manage the first 20 tracks.
      waveId = getWaveIdentifier(audioPlayer, imSticky, singleTrack);
    }else if(imSticky || audioPlayer && !singleTrack){
      waveId = getWaveIdentifier(audioPlayer, imSticky, singleTrack);
    }
  
    if (!waveResizeHandlers.has(waveId)){
      // Debounced resize handler for this specific wave
     // Store the initial width
    let windowWidth = window.innerWidth;

    const debouncedResizeHandler = debounce(() => {
      // Check if the width has changed
      if (window.innerWidth !== windowWidth) {
        createFakeWave(audioPlayer, imSticky, singleTrack);
        // Update the stored width
        windowWidth = window.innerWidth;
      }
    }, 250);

      // Add the resize listener and store the handler in the map
      window.addEventListener('resize', debouncedResizeHandler);
      waveResizeHandlers.set(waveId, debouncedResizeHandler);
    }

   
    var peaks = [];
    var barGap;
    var barWidth;
    var lineCap;
    var fadeDuration;
    var totalBarWidth;
    var waveBaseDiv;
    var waveBaseWidth;
    var canvasWidth;
    var canvasHeight;
    var desiredNumBars;
    var downsamplingFactor;
    var numBars;
    
    var peakFile = singleTrack && singleTrack.attr('data-peakFile') != '' ? singleTrack.attr('data-peakFile') :
      // If 'singleTrack' condition was false, check if 'imSticky' is truthy
      imSticky ? IRON.sonaar.player.list.tracks[IRON.sonaar.player.currentTrack].peakFile :
        // If 'imSticky' condition was false, check if 'audioPlayer' exists, 'audioPlayer.currentTrack' is defined, and the current track has a non-empty 'data-peakFile' attribute
        !singleTrack && audioPlayer && typeof audioPlayer.currentTrack != 'undefined' && audioPlayer.find('sr-playlist-item').eq(audioPlayer.currentTrack).attr('data-peakFile') != '' ? audioPlayer.find('.sr-playlist-item').eq(audioPlayer.currentTrack).attr('data-peakFile') :
          // If none of the above conditions were met, set 'peakFile' to false
          false;

    var defaultPeaks = "000010101110101110101011111010111011111111111011111111211111111111112121112121111121212121211121112232111121313121112222122221512132213121313121214242313222312132322131423131413132313122223132323222212221214222@=IGHJJ<C?==9=:5:96455568357;5543;62;5377058974285788228628436714217747328825538633625626746736578643454635555460353434678442662533491561562745573344453444575335442434553:7@HCLB9=C;<9<95455774235666473782354464453372546671634354443673>G:NCCBA=;843352463453386757465563784252443563533372332551223354F;DE?89?=:A;:<@=98554475367:66636575444573D=CMDA@C:9;<==;8<97762345353444553333432453241655463644443533222433334446452323443223344565775523345425232333233312232223332122222324123233222232322322222311222111131129B:?CCLN@F9;;:668334222223334526255445322232523153338232324323329AA?G@7EB><;:645235142524956:27:56434343324332335192514224234322;>F<@HC?>=87833432323260596659445456542332BGN<IDIBGABCA>C65@?<<<<7743445455476534333415663834744544432323222323334326644222232478595<7@<;=><>?;><54;:6575241322232222222213131434433222122212121113122222311211121C2NLFQHA:G@DE>=>C@??;;:82873346643354535233253433341354333422222J2=>FMC@BE=9<:44332231:6:<9>;???>><??6<@>;>;:8563383343333363222E5=@AG?>?:<=?8=<=><96832553545554334445442J2GALPD<:KBJBG?A=C=:7><867744434556432233443254444735254444454244422423434435543322432;988@<=<>?>:=A??<9;;;638524233322132232233423252333434224232224232232333322121222332?HK9BBGQC?B?=EBB;K==>C;;74336865763532534334547354435442245443:3?HF<>A?A85:;;?646453<4;889C;?@:??>@>9>@77;@89:;24164736442534289FIC=A@<>?<:97856846756489:9:86663567579544E??GFBNGA?<8E<HA??9AB8=99878753854<48:9269:69496>:5348766355505416857769645655764537@::?@CFHF<A?HA?@ABA;;=57742574766584553662713593551573432573452582646472336574546354AKJRPGIJHDG?BCIA:@A5<<?7875464657:673572546681555472542374356463ILI>FL=9;;663474525596?=8=EB?A@@G:AA@@@<9>:4988295<3554454455363>A>?FI?B?;?:>9>=:874549373:872568634648662IJDBH<FEH;>OFF?F=CAB?=5884955586567444959345767469859665647874557564635375636264856377>?::E?F<?HB@?;6@@8<A@;8:34537362567364335686665543545353586444535682345552745443847?BOQHEIDCFH@7?CC<D66>;55:7553544788765766;355587473559675467677O;O:EJBA?CA;8676737464::@::=@NA?JD=BB@AC<>>98;928665839656;47585;C;CMC<B=A=;84;776946566436927464465453543WJNVMCXQTJLF8GB8;9>7<<@5@DH?BEI9BC=;6;8;:8>989;:CC@CE>?B<A@<<CC6>;?>EB:>>9=B;A=?9??9;BSCENQ?HCIFRG=465;998==D<E?FB>F@=ADA;:76:<8;=B@HEIKM;DBCG?=EBD@BD@?>>BBC9>AAD<D@=?<9?IIHHPO_QNGWCDC=:=D=77=D7?DJ55HF94?@39;95>:9<C?E:C@?@@@=?@<>>=:9IB2SJFJEMCBG@<=FJMA?@JIFMHCBKMBZI9D=59:B3<;=66CE>F@A<<@F:;886;9:>IIM>NLNDDLH>EDID@FABD<@DB>A>?A@=>>@9;>:B>??SXKXVPSGKUFE?DH87><<8A<CDDI@ACA;<;8962695;@=>A<?D?5@<FG<;BAG@7C?;IDD;>@E=;<<AG<@C>:MBE=@KTLMHM?IA9<86:07:E44;I85HE97EB:6=<6:8<;D=?<8IEEB;=BED<@9;BB@<;<GC=B:=D<?@<=D=ANY?KOVPRTWRS@?A<@B@@<<@>1>?F5CGG<9E<168:597>4@8;79:;=G==995C>?::5KCMFJAEGEQ>E?IA7<3:C?NE<QEKKPMIGPBE97D8673;9A;EFIGG@A;8;>35:95:8L@GQE@@BFCKFJ==4@AHB;5?6GA>8<;@=<:@AD89;<MbQO[PKPRKGI?FC9=;@?9C=>77BH99CJ<5A<936;9965=99<?C:ED>?;BL;B>CF;=A>MF?=C@>@;>>4:?><>=?PWBOTJWNAOC9?67:7:88<E54GJB;GB9:DF=6;;9@9?I8DD8B?EJ@CFG@>;:D?=?GIA??9?9C=@@?:@9BD;AA<QHMAZJWMONQLI<G8@;:;7<B:D<C@J@NE?@<9=:C9C@J>CJRIC7FDDCC?D=D<6D>C@EMHFANFDFFCG@H8>DXEQK??F?EGNEUIB;=6<?=47;=>8?JC<@@57EC=7:=2:7LHHDADPABKJQQ?E@CADFC:EA?EJ@NFB>@>EB?97A<<CPHQQPPLRJNQW<98=?F87CH8<@ED3BN9<HD<ED@=;=B@IF=DC===B:::F6<@8:>=@9>B?8D>BA@A>?>>?<=7JKOPTZGGGGN>MJIBKB=5F>CB=HOJ?I?@AHB;ECB=H<=DNCOMNBEFE@=7C9<<<;7:;9?6@<@;:9=7=54586:75@SOLKYSFFCFUPEBOB=KNF;CD6<JRD<IC=IGOE=?=85;CA?<=A?<:;8<D<>5@;A49:8;=;I?8@<4<=9:<67784946:8:;274839667:77487967657638367938756748445735635:36474645496845346824556533446747546513331254673444233325443432341221252533342323331232232313243323221222231313332113221222121222112212211212111212111111111111111112111111111111111101111111110111110111111101000100000000000000000000000000000000000000000000000000000000000000000";

    async function getPeaksFromJSON(peakFile) {
      if (IRON.peaksCache[peakFile]) {
          //console.log('get file from cache : ', peakFile);
          return IRON.peaksCache[peakFile];
      } else if (IRON.peaksCache[peakFile] === undefined) {
          // Store a promise in the cache for the ongoing fetch
          //console.log('load the peak! : ', peakFile);
          IRON.peaksCache[peakFile] = fetch(peakFile)
              .then(response => response.text())
              .then(peaksData => {
                  const peaks = peaksData.split('').map(c => (c.charCodeAt() - 48) / 100);
                  return peaks;
              });
  
          return IRON.peaksCache[peakFile];
      } else {
          // Wait for the ongoing fetch to complete
          return await IRON.peaksCache[peakFile];
      }
  }
  

    function shuffleArray(array) {
      for (let i = array.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [array[i], array[j]] = [array[j], array[i]]; // Swap elements
      }
    }

    (async () => {

      if (loadFakeWaveOnly || !peakFile) { //If we force fakewave from plugin option or peakfile does not exist
        peaks = defaultPeaks.split('').map(c => (c.charCodeAt() - 48) / 100);
        shuffleArray(peaks);
      } else {
        peaks = await getPeaksFromJSON(peakFile);
      }
      const progressType = ( singleTrack && typeof audioPlayer.data('tracklist-soundwave-style') !== 'undefined' ) ? audioPlayer.data('tracklist-soundwave-style') : audioPlayer.progressType;

      function initCreateWaves(){
        if (!imSticky && progressType == "simplebar" || imSticky && sonaar_music.option.waveformType == "simplebar") return;

        const container = sr_canvas_container;
        const $waveParent = $(container).parents('.sonaar_fake_wave');
        const $waveCut = $waveParent.find('.sonaar_wave_cut');

        $waveCut.css('display', 'none');
        if( !$waveCut.attr('style').includes('width:') ){
          $waveCut.css('width', '0px');
        }
        waveBaseDiv         = container.closest(".sonaar_fake_wave");
        if(typeof $waveParent.data('width') === 'undefined'){
          waveBaseWidth       = waveBaseDiv.clientWidth;
          $waveParent.data('width', waveBaseWidth);
        }else{
          waveBaseWidth       = $waveParent.data('width');
        }

        canvasWidth         = (waveBaseWidth != 0) ? waveBaseWidth : 1000; //Set the width to 1000 when `waveBaseWidth` is 0 to prevent players from tabs, accordions, and other hidden elements from having a canvas width of 0.
        canvasHeight        = container.height;
       
        barWidth            = parseInt($(container).parents('[data-wave-bar-width]').attr('data-wave-bar-width'),10) || parseInt(sonaar_music.option.music_player_barwidth, 10) || 2; // Adjust as needed
        lineCap             = $(container).parents('[data-wave-line-cap]').attr('data-wave-line-cap') || sonaar_music.option.music_player_linecap  || 'square'; // Can be 'butt', 'round', or 'square'

        if($(container).parents('[data-wave-bar-gap]').length){//if shortcode parameters is set
          barGap              = parseInt($(container).parents('[data-wave-bar-gap]').attr('data-wave-bar-gap'),10);
        }else if(typeof sonaar_music.option.music_player_bargap !== 'undefined'){ // plugin option
          barGap              = parseInt(sonaar_music.option.music_player_bargap, 10); 
        }else{
          barGap              = 0;
        }

        if($(container).parents('[data-wave-fadein]').length){ //if shortcode parameters is set
          fadeDuration        = ($(container).parents('[data-wave-fadein]').attr('data-wave-fadein')==='false')? 1 : 350;
        }else if(typeof sonaar_music.option.music_player_wave_disable_fadein !== 'undefined'){ // plugin option
          fadeDuration        = ( sonaar_music.option.music_player_wave_disable_fadein !== 'on')? 350 : 1;
        }else{
          fadeDuration        = 350; // Duration in milliseconds for each bar to fully appear
        }
        if(singleTrack){
          fadeDuration = 1;
        }

        totalBarWidth       = barWidth + barGap;
        desiredNumBars      = canvasWidth / totalBarWidth;
        downsamplingFactor  = peaks.length / desiredNumBars; // Calculate the downsampling factor dynamically based on desired number of bars
        numBars              = Math.ceil(peaks.length / downsamplingFactor);
        if(typeof waveColor === 'undefined'){
          waveColor = (imSticky) ? '#606060' : '#000000';
         
        };
        if(typeof waveProgressColor === 'undefined'){
          waveProgressColor = (imSticky) ? '#FFF' : '#202020';
        };

        createWaves(sr_canvas_container, waveColor, lineCap);
        createWaves(sr_canvas_progress, waveProgressColor, lineCap);

      }

      function createWaves(container, waveColor, lineCap) {
        const canvas    = container;
          const ctx       = canvas.getContext("2d");
          canvas.height   = canvasHeight;
          ctx.lineCap     = lineCap;
          ctx.lineWidth   = Math.floor(barWidth); // Ensure integer value
          var imProgressBar   = false;
          if($(container).parents('.sonaar_wave_cut').length){
            imProgressBar = true;
          }
          //canvas.width        = waveBaseWidth;
          /*console.log('------------------');
          console.log(audioPlayer[0]);
          console.log("Peaks Length Total: ", peaks.length);
          console.log("Canvas Width:", canvasWidth);
          console.log("totalBarWidth:", totalBarWidth);
          console.log("desiredNumBars:", desiredNumBars);
          console.log("downsamplingFactor:", downsamplingFactor);
          console.log("numBars:", numBars);*/
          var barColor;
          if (waveColor.substring(0, 3) === "rgb") {
            barColor = reformatRgb(waveColor);
          }else{
            barColor = hexToRgb(waveColor);
          }

          const startTime = Date.now(); // Start time of the animation

         

          function drawBars() {
            if(!imSticky && !singleTrack && IRON.addDownloadSVGButton.saveSVG){
              IRON.addDownloadSVGButton.svgElements = [];
            }
            ctx.clearRect(0, 0, canvasWidth, canvasHeight); // Clear the canvas

            const currentTime         = Date.now();
            let anyBarNotFullyOpaque  = false;
            const modifHeight         = (lineCap === 'butt') ? 0 : barWidth;
            const maxHeight           = Math.floor((canvasHeight - modifHeight) * 2);
            const maxPeak             = Math.max(...peaks);
            const scalingFactor       = maxHeight / (maxPeak * 2);
        
            for (let i = 0; i < numBars; i++) {
                const index       = Math.floor(i * downsamplingFactor);
                let barHeight     = peaks[index] * scalingFactor;
                if(imProgressBar){
                  barHeight = barHeight + 2.5;
                }
                barHeight         = Math.floor(barHeight);
                barHeight         = barHeight === 1 ? 2 : barHeight;
                const x           = Math.floor(i * (barWidth + barGap));
                const y           = Math.round((canvasHeight - barHeight)/2);
                const timeElapsed = currentTime - startTime;
                let opacity       = (timeElapsed - i * (fadeDuration / numBars)) / fadeDuration;
                opacity           = Math.min(Math.max(opacity, 0), barColor.a); // Ensure opacity doesn't exceed initial alpha value
                ctx.strokeStyle   = `rgba(${barColor.r}, ${barColor.g}, ${barColor.b}, ${opacity})`;
                
                ctx.beginPath();
                ctx.moveTo(x + barWidth / 2, y);
                ctx.lineTo(x + barWidth / 2, y + barHeight);
                ctx.stroke();

                if(!imSticky && !singleTrack && IRON.addDownloadSVGButton.saveSVG){
                  IRON.addDownloadSVGButton.svgElements.push(`<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight+1}" fill="#000000" rx="roundingValue" ry="roundingValue"/>`);

                  //square IRON.addDownloadSVGButton.svgElements.push(`<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight+1}" fill="#000000"/>`);
                }

                if (opacity < barColor.a) {
                  anyBarNotFullyOpaque = true;
                }

            }

            if(!imSticky && !singleTrack && IRON.addDownloadSVGButton.saveSVG){
              IRON.addDownloadSVGButton.svgString = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}">${IRON.addDownloadSVGButton.svgElements.join('')}</svg>`;
            }
            if (anyBarNotFullyOpaque) {
              requestAnimationFrame(drawBars);
            }
        }
        
        drawBars(); // Start the animation
        $(container).parents('.sonaar_fake_wave').find('.sonaar_wave_cut').css('display', 'inherit');


    };

    function hexToRgb(hex) {
      let r = 0, g = 0, b = 0, a = 1;
  
      // Remove the hash at the start if it's there
      hex = hex.replace(/^#/, '');
  
      if (hex.length === 3) { // Convert #RGB to #RRGGBB
          hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
  
      if (hex.length === 6) { // Process it as #RRGGBB
          r = parseInt(hex.slice(0, 2), 16);
          g = parseInt(hex.slice(2, 4), 16);
          b = parseInt(hex.slice(4, 6), 16);
      } else if (hex.length === 8) { // Process it as #RRGGBBAA
          r = parseInt(hex.slice(0, 2), 16);
          g = parseInt(hex.slice(2, 4), 16);
          b = parseInt(hex.slice(4, 6), 16);
          a = parseInt(hex.slice(6, 8), 16) / 255;
      }
      return { r, g, b, a };
    }

    function reformatRgb(color) {
      const colorValues = color.match(/(\d+(\.\d+)?)%?/g).map(Number);
      const isRGBA = color.includes("rgba");
      const alpha = isRGBA ? colorValues[3] : 1;
      return {
        r: colorValues[0],
        g: colorValues[1],
        b: colorValues[2],
        a: alpha
      };
    }
  
    var waveColor         = $(audioPlayer).attr('data-wave-color') || audioPlayer.soundwaveColorBG || sonaar_music.option.music_player_timeline_color;
    var waveProgressColor = $(audioPlayer).attr('data-wave-progress-color') || audioPlayer.soundwaveProgressColor || sonaar_music.option.music_player_progress_color;
    
    if(singleTrack){
      if(typeof audioPlayer.data('tracklist-wave-color') != 'undedined') {
        waveColor = audioPlayer.data('tracklist-wave-color') || sonaar_music.option.music_player_timeline_color;
      }
      if(typeof audioPlayer.data('tracklist-wave-progress-color') != 'undedined') {
        waveProgressColor = audioPlayer.data('tracklist-wave-progress-color') || sonaar_music.option.music_player_progress_color;
      }
    }


    /*if (IRON.isSonaarTheme && srp_pluginEnable) {
      IRON.audioPlayer.stickyEnable = true;
    }*/

    if (imSticky && sonaar_music.option.waveformType == "simplebar" ) {
      // set the heights of the bars
      let barHeight     = (typeof sonaar_music.option.sr_soundwave_height_simplebar !== 'undefined') ? sonaar_music.option.sr_soundwave_height_simplebar + "px" : "";
      let cssCode       = '.sonaar_fake_wave .sonaar_wave_base, .sonaar_fake_wave .sonaar_wave_cut, div#sonaar-player .srp_extendedPlayer_container .sr_progressbar_sticky .wave{ height: ' + barHeight +' !important;}';
      let $inlineStyle  = $("#sonaar-music-inline-css");

      if ($inlineStyle.length === 0 || !$inlineStyle.text().includes(cssCode)) {
        $inlineStyle.append(cssCode);
      }

    }

    // RETURN IF SIMPLE BAR IS USED - NO NEED TO CREATE FAKEWAVES. This is 100% sur that sticky and player are simplebar.
    if (sonaar_music.option.waveformType == "simplebar" && progressType !== "mediaElement") {
      return;
    }

    if( progressType == "simplebar" ){
      audioPlayer = false; // set audio player to false because we wont use it anymore
    }


    if(singleTrack){

      var soundwaveWrapper    = $(singleTrack).find('.srp_soundwave_wrapper');
      //soundwaveWrapper.css('width', '100%');
      soundwaveWrapper.find('.sonaar_fake_wave').css('height', '40px').css('margin-top', '0px').css('margin-bottom', '0px');

      var sr_canvas_container     = $(singleTrack).find('.sonaar_wave_base canvas')[0];
      var sr_canvas_progress      = $(singleTrack).find('.sonaar_wave_cut canvas')[0];
      containerHeight             = $(singleTrack).find(".sonaar_fake_wave").css("height");
      sr_canvas_container.height  = parseInt(containerHeight, 10);
      sr_canvas_progress.height   = parseInt(containerHeight, 10);    

    }else if ( audioPlayer ) {

      var sr_canvas_container   = $(audioPlayer).find('.album-player .sonaar_wave_base canvas')[0];
      var sr_canvas_progress    = $(audioPlayer).find('.album-player .sonaar_wave_cut canvas')[0];

      if( $(audioPlayer).find(".album-player .sonaar_fake_wave").css("height") === "0px" ){
        $(audioPlayer).find(".album-player .sonaar_fake_wave").css("height", "70px");
      };
      
      containerHeight             = $(audioPlayer).find(".album-player .sonaar_fake_wave").css("height");
      

      sr_canvas_container.height  = parseInt(containerHeight, 10);
      sr_canvas_progress.height   = parseInt(containerHeight, 10);     


      if(!imSticky){
        audioPlayer.find('.album-player .sonaar_wave_base').css('background-color', 'unset');
        audioPlayer.find('.album-player .sonaar_wave_cut').css('background-color', 'unset');
      }

    }
    //CREATE THE RANDOM PEAK BARS with conditions to prevent to many if. numBars is pretty high
    if( !imSticky && typeof sr_canvas_container !== 'undefined' && sr_canvas_container !== null ){
      // PLAYER
      initCreateWaves();
      return;
    }


    if(imSticky ){
      // STICKY PLAYER
      var sr_canvas_container = document.getElementById('splayer-wave-container');
      var sr_canvas_progress  = document.getElementById('splayer-wave-progress');
      
      //set soundwave colors
      if (typeof IRON.audioPlayer.activePlayer !== 'undefined' && IRON.audioPlayer.activePlayer.adaptiveColors && sonaar_music.option.sticky_player_disable_adaptive_colors != 'true'){
        waveColor           = (typeof IRON.audioPlayer !== 'undefined' && typeof IRON.audioPlayer.activePlayer.adaptiveColors !== 'undefined') ? IRON.audioPlayer.activePlayer.paletteColorsHex[2] : sonaar_music.option.sticky_player_soundwave_bars;
        waveProgressColor   = (typeof IRON.audioPlayer !== 'undefined' && typeof IRON.audioPlayer.activePlayer.adaptiveColors !== 'undefined') ? IRON.audioPlayer.activePlayer.paletteColorsHex[1] : sonaar_music.option.sticky_player_soundwave_progress_bars;
      }else{
        waveColor           = sonaar_music.option.sticky_player_soundwave_bars;
        waveProgressColor   = sonaar_music.option.sticky_player_soundwave_progress_bars;
      }

      initCreateWaves();
      return;
    }
  })();
  };
  
  // Debounce function
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }
  
  // Function to generate a unique identifier for each wave
  function getWaveIdentifier(audioPlayer, imSticky, singleTrack) {
    let identifier = '';

    if (audioPlayer) {
      if(!singleTrack){
        identifier += 'player_' + audioPlayer.id;
      }
    }

    if (imSticky) {
      identifier += 'sticky';
    }

    if (singleTrack && singleTrack.length > 0) {
      const trackIndex = singleTrack.index();
      identifier += 'player_' + audioPlayer.id + '_trackIndex_' + trackIndex; 
    }

    return identifier || 'default';
  }

  removePlayerResizeListeners = function(playerId) {
    waveResizeHandlers.forEach((handler, waveId) => {
        if (waveId && waveId.includes("trackIndex_")) {
          if(waveId.includes(playerId)){
            window.removeEventListener('resize', handler);
            waveResizeHandlers.delete(waveId); // Remove the item from the map
          }
        }
    });
  }

  const waveResizeHandlers = new Map();
  // Assign the function to the IRON object
  IRON.createFakeWave = createFakeWave; // IRON.createFakeWave introduced in v5, but MP3 Audio Player Pro v4 supports only createFakeWave(). So we need to keep both for backward compatibility
  IRON.removePlayerResizeListeners = removePlayerResizeListeners; 


  //Replace CTA button by ellipsis on small device
  sr_playerCTAresponsive = function () {
    $('.iron-audioplayer:not(.srp_has_customfields):not(.srp_tracklist_grid)').each(function () {
      const selector = $(this).parents('[class*="sr_track_inline_cta_bt"]:not(.srp_track_cta_fixed)');
      if( selector.length ){
        let sr_ctaEnable = true;
        $(this).find('.sr-playlist-item:not([data-relatedtrack="1"])').each(function () {
          const min_breakpoint = ($(this).find('.audio-track').width() < 200 )? 200: $(this).find('.audio-track').width();
          if( min_breakpoint + $(this).find('.song-store-list-container').width() >= $(this).width()){
            sr_ctaEnable = false;
          }
        })
        if (sr_ctaEnable ) {
          selector.removeClass('sr_track_inline_cta_bt__no')
          selector.addClass('sr_track_inline_cta_bt__yes')
        } else {
          selector.removeClass('sr_track_inline_cta_bt__yes')
          selector.addClass('sr_track_inline_cta_bt__no')
        }
      }
    })
  }

  //Close And Open Player widget Store List container
  $(document).on('click', function () {
    closeStoreListContainer('.srp_cta_opened');
  });

  $('.store-list').on('click', function () {
    if (!$(this).find('.srp_cta_opened').length) {
      openStoreListContainer($(this).find('.song-store-list-menu')[0]);
    }
  });

  openStoreListContainer = function (el) {
    if ($(el).parents('.sr_track_inline_cta_bt__yes').length) {
      return;
    }
    closeStoreListContainer('.srp_cta_opened');
    var theyShouldBeClosed = setInterval(function () { // Wait until all other store list container is closed
      if ($('.srp_cta_opened').length == 0) {
        $(el).find('.song-store-list-container').show(0, function () {
        }).animate({ opacity: 1 }, 150, function () {
          $(el).find('.song-store-list-container').addClass('srp_cta_opened');
        });
        $(el).find('.song-store-list-container').addClass('srp_cta_ready');
        clearInterval(theyShouldBeClosed);
      }
    }, 100);
  }

  closeStoreListContainer = function (el) {
    if ($(el).parents('.sr_track_inline_cta_bt__yes').length) {
      return;
    }
    $(el).animate({ opacity: 0 }, 150, 'swing', function () {
      $(el).hide(0);
    });
    $(el).removeClass('srp_cta_opened');
  }

  //Call Function on window Resize
  let resizeTimer;
  $(window).resize(function () {
    if (resizeTimer != null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {

      //Call function here...
      sr_playerCTAresponsive();

    }, 200);
  });

  //Take "01:05:25" and return "3925" sec.
  convertTime = function (time) {
    time = time.toString().split(':').reverse();
    let newTime = 0;
    $(time).each(function (index) {
      newTime = newTime + parseInt(this) * (60 ** (index));
    })
    return (newTime);
  }
  
})(jQuery);

//Check if the we are int the guttenberg editor
function isGutenbergActive() {
  return document.body.classList.contains('block-editor-page');
}
;
//! moment.js
//! version : 2.30.1
//! authors : Tim Wood, Iskren Chernev, Moment.js contributors
//! license : MIT
//! momentjs.com

!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?module.exports=t():"function"==typeof define&&define.amd?define(t):e.moment=t()}(this,function(){"use strict";var H;function _(){return H.apply(null,arguments)}function y(e){return e instanceof Array||"[object Array]"===Object.prototype.toString.call(e)}function F(e){return null!=e&&"[object Object]"===Object.prototype.toString.call(e)}function c(e,t){return Object.prototype.hasOwnProperty.call(e,t)}function L(e){if(Object.getOwnPropertyNames)return 0===Object.getOwnPropertyNames(e).length;for(var t in e)if(c(e,t))return;return 1}function g(e){return void 0===e}function w(e){return"number"==typeof e||"[object Number]"===Object.prototype.toString.call(e)}function V(e){return e instanceof Date||"[object Date]"===Object.prototype.toString.call(e)}function G(e,t){for(var n=[],s=e.length,i=0;i<s;++i)n.push(t(e[i],i));return n}function E(e,t){for(var n in t)c(t,n)&&(e[n]=t[n]);return c(t,"toString")&&(e.toString=t.toString),c(t,"valueOf")&&(e.valueOf=t.valueOf),e}function l(e,t,n,s){return Wt(e,t,n,s,!0).utc()}function p(e){return null==e._pf&&(e._pf={empty:!1,unusedTokens:[],unusedInput:[],overflow:-2,charsLeftOver:0,nullInput:!1,invalidEra:null,invalidMonth:null,invalidFormat:!1,userInvalidated:!1,iso:!1,parsedDateParts:[],era:null,meridiem:null,rfc2822:!1,weekdayMismatch:!1}),e._pf}function A(e){var t,n,s=e._d&&!isNaN(e._d.getTime());return s&&(t=p(e),n=j.call(t.parsedDateParts,function(e){return null!=e}),s=t.overflow<0&&!t.empty&&!t.invalidEra&&!t.invalidMonth&&!t.invalidWeekday&&!t.weekdayMismatch&&!t.nullInput&&!t.invalidFormat&&!t.userInvalidated&&(!t.meridiem||t.meridiem&&n),e._strict)&&(s=s&&0===t.charsLeftOver&&0===t.unusedTokens.length&&void 0===t.bigHour),null!=Object.isFrozen&&Object.isFrozen(e)?s:(e._isValid=s,e._isValid)}function I(e){var t=l(NaN);return null!=e?E(p(t),e):p(t).userInvalidated=!0,t}var j=Array.prototype.some||function(e){for(var t=Object(this),n=t.length>>>0,s=0;s<n;s++)if(s in t&&e.call(this,t[s],s,t))return!0;return!1},Z=_.momentProperties=[],z=!1;function q(e,t){var n,s,i,r=Z.length;if(g(t._isAMomentObject)||(e._isAMomentObject=t._isAMomentObject),g(t._i)||(e._i=t._i),g(t._f)||(e._f=t._f),g(t._l)||(e._l=t._l),g(t._strict)||(e._strict=t._strict),g(t._tzm)||(e._tzm=t._tzm),g(t._isUTC)||(e._isUTC=t._isUTC),g(t._offset)||(e._offset=t._offset),g(t._pf)||(e._pf=p(t)),g(t._locale)||(e._locale=t._locale),0<r)for(n=0;n<r;n++)g(i=t[s=Z[n]])||(e[s]=i);return e}function $(e){q(this,e),this._d=new Date(null!=e._d?e._d.getTime():NaN),this.isValid()||(this._d=new Date(NaN)),!1===z&&(z=!0,_.updateOffset(this),z=!1)}function k(e){return e instanceof $||null!=e&&null!=e._isAMomentObject}function B(e){!1===_.suppressDeprecationWarnings&&"undefined"!=typeof console&&console.warn&&console.warn("Deprecation warning: "+e)}function e(r,a){var o=!0;return E(function(){if(null!=_.deprecationHandler&&_.deprecationHandler(null,r),o){for(var e,t,n=[],s=arguments.length,i=0;i<s;i++){if(e="","object"==typeof arguments[i]){for(t in e+="\n["+i+"] ",arguments[0])c(arguments[0],t)&&(e+=t+": "+arguments[0][t]+", ");e=e.slice(0,-2)}else e=arguments[i];n.push(e)}B(r+"\nArguments: "+Array.prototype.slice.call(n).join("")+"\n"+(new Error).stack),o=!1}return a.apply(this,arguments)},a)}var J={};function Q(e,t){null!=_.deprecationHandler&&_.deprecationHandler(e,t),J[e]||(B(t),J[e]=!0)}function a(e){return"undefined"!=typeof Function&&e instanceof Function||"[object Function]"===Object.prototype.toString.call(e)}function X(e,t){var n,s=E({},e);for(n in t)c(t,n)&&(F(e[n])&&F(t[n])?(s[n]={},E(s[n],e[n]),E(s[n],t[n])):null!=t[n]?s[n]=t[n]:delete s[n]);for(n in e)c(e,n)&&!c(t,n)&&F(e[n])&&(s[n]=E({},s[n]));return s}function K(e){null!=e&&this.set(e)}_.suppressDeprecationWarnings=!1,_.deprecationHandler=null;var ee=Object.keys||function(e){var t,n=[];for(t in e)c(e,t)&&n.push(t);return n};function r(e,t,n){var s=""+Math.abs(e);return(0<=e?n?"+":"":"-")+Math.pow(10,Math.max(0,t-s.length)).toString().substr(1)+s}var te=/(\[[^\[]*\])|(\\)?([Hh]mm(ss)?|Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Qo?|N{1,5}|YYYYYY|YYYYY|YYYY|YY|y{2,4}|yo?|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|kk?|mm?|ss?|S{1,9}|x|X|zz?|ZZ?|.)/g,ne=/(\[[^\[]*\])|(\\)?(LTS|LT|LL?L?L?|l{1,4})/g,se={},ie={};function s(e,t,n,s){var i="string"==typeof s?function(){return this[s]()}:s;e&&(ie[e]=i),t&&(ie[t[0]]=function(){return r(i.apply(this,arguments),t[1],t[2])}),n&&(ie[n]=function(){return this.localeData().ordinal(i.apply(this,arguments),e)})}function re(e,t){return e.isValid()?(t=ae(t,e.localeData()),se[t]=se[t]||function(s){for(var e,i=s.match(te),t=0,r=i.length;t<r;t++)ie[i[t]]?i[t]=ie[i[t]]:i[t]=(e=i[t]).match(/\[[\s\S]/)?e.replace(/^\[|\]$/g,""):e.replace(/\\/g,"");return function(e){for(var t="",n=0;n<r;n++)t+=a(i[n])?i[n].call(e,s):i[n];return t}}(t),se[t](e)):e.localeData().invalidDate()}function ae(e,t){var n=5;function s(e){return t.longDateFormat(e)||e}for(ne.lastIndex=0;0<=n&&ne.test(e);)e=e.replace(ne,s),ne.lastIndex=0,--n;return e}var oe={D:"date",dates:"date",date:"date",d:"day",days:"day",day:"day",e:"weekday",weekdays:"weekday",weekday:"weekday",E:"isoWeekday",isoweekdays:"isoWeekday",isoweekday:"isoWeekday",DDD:"dayOfYear",dayofyears:"dayOfYear",dayofyear:"dayOfYear",h:"hour",hours:"hour",hour:"hour",ms:"millisecond",milliseconds:"millisecond",millisecond:"millisecond",m:"minute",minutes:"minute",minute:"minute",M:"month",months:"month",month:"month",Q:"quarter",quarters:"quarter",quarter:"quarter",s:"second",seconds:"second",second:"second",gg:"weekYear",weekyears:"weekYear",weekyear:"weekYear",GG:"isoWeekYear",isoweekyears:"isoWeekYear",isoweekyear:"isoWeekYear",w:"week",weeks:"week",week:"week",W:"isoWeek",isoweeks:"isoWeek",isoweek:"isoWeek",y:"year",years:"year",year:"year"};function o(e){return"string"==typeof e?oe[e]||oe[e.toLowerCase()]:void 0}function ue(e){var t,n,s={};for(n in e)c(e,n)&&(t=o(n))&&(s[t]=e[n]);return s}var le={date:9,day:11,weekday:11,isoWeekday:11,dayOfYear:4,hour:13,millisecond:16,minute:14,month:8,quarter:7,second:15,weekYear:1,isoWeekYear:1,week:5,isoWeek:5,year:1};var de=/\d/,t=/\d\d/,he=/\d{3}/,ce=/\d{4}/,fe=/[+-]?\d{6}/,n=/\d\d?/,me=/\d\d\d\d?/,_e=/\d\d\d\d\d\d?/,ye=/\d{1,3}/,ge=/\d{1,4}/,we=/[+-]?\d{1,6}/,pe=/\d+/,ke=/[+-]?\d+/,Me=/Z|[+-]\d\d:?\d\d/gi,ve=/Z|[+-]\d\d(?::?\d\d)?/gi,i=/[0-9]{0,256}['a-z\u00A0-\u05FF\u0700-\uD7FF\uF900-\uFDCF\uFDF0-\uFF07\uFF10-\uFFEF]{1,256}|[\u0600-\u06FF\/]{1,256}(\s*?[\u0600-\u06FF]{1,256}){1,2}/i,u=/^[1-9]\d?/,d=/^([1-9]\d|\d)/;function h(e,n,s){Ye[e]=a(n)?n:function(e,t){return e&&s?s:n}}function De(e,t){return c(Ye,e)?Ye[e](t._strict,t._locale):new RegExp(f(e.replace("\\","").replace(/\\(\[)|\\(\])|\[([^\]\[]*)\]|\\(.)/g,function(e,t,n,s,i){return t||n||s||i})))}function f(e){return e.replace(/[-\/\\^$*+?.()|[\]{}]/g,"\\$&")}function m(e){return e<0?Math.ceil(e)||0:Math.floor(e)}function M(e){var e=+e,t=0;return t=0!=e&&isFinite(e)?m(e):t}var Ye={},Se={};function v(e,n){var t,s,i=n;for("string"==typeof e&&(e=[e]),w(n)&&(i=function(e,t){t[n]=M(e)}),s=e.length,t=0;t<s;t++)Se[e[t]]=i}function Oe(e,i){v(e,function(e,t,n,s){n._w=n._w||{},i(e,n._w,n,s)})}function be(e){return e%4==0&&e%100!=0||e%400==0}var D=0,Y=1,S=2,O=3,b=4,T=5,Te=6,xe=7,Ne=8;function We(e){return be(e)?366:365}s("Y",0,0,function(){var e=this.year();return e<=9999?r(e,4):"+"+e}),s(0,["YY",2],0,function(){return this.year()%100}),s(0,["YYYY",4],0,"year"),s(0,["YYYYY",5],0,"year"),s(0,["YYYYYY",6,!0],0,"year"),h("Y",ke),h("YY",n,t),h("YYYY",ge,ce),h("YYYYY",we,fe),h("YYYYYY",we,fe),v(["YYYYY","YYYYYY"],D),v("YYYY",function(e,t){t[D]=2===e.length?_.parseTwoDigitYear(e):M(e)}),v("YY",function(e,t){t[D]=_.parseTwoDigitYear(e)}),v("Y",function(e,t){t[D]=parseInt(e,10)}),_.parseTwoDigitYear=function(e){return M(e)+(68<M(e)?1900:2e3)};var x,Pe=Re("FullYear",!0);function Re(t,n){return function(e){return null!=e?(Ue(this,t,e),_.updateOffset(this,n),this):Ce(this,t)}}function Ce(e,t){if(!e.isValid())return NaN;var n=e._d,s=e._isUTC;switch(t){case"Milliseconds":return s?n.getUTCMilliseconds():n.getMilliseconds();case"Seconds":return s?n.getUTCSeconds():n.getSeconds();case"Minutes":return s?n.getUTCMinutes():n.getMinutes();case"Hours":return s?n.getUTCHours():n.getHours();case"Date":return s?n.getUTCDate():n.getDate();case"Day":return s?n.getUTCDay():n.getDay();case"Month":return s?n.getUTCMonth():n.getMonth();case"FullYear":return s?n.getUTCFullYear():n.getFullYear();default:return NaN}}function Ue(e,t,n){var s,i,r;if(e.isValid()&&!isNaN(n)){switch(s=e._d,i=e._isUTC,t){case"Milliseconds":return i?s.setUTCMilliseconds(n):s.setMilliseconds(n);case"Seconds":return i?s.setUTCSeconds(n):s.setSeconds(n);case"Minutes":return i?s.setUTCMinutes(n):s.setMinutes(n);case"Hours":return i?s.setUTCHours(n):s.setHours(n);case"Date":return i?s.setUTCDate(n):s.setDate(n);case"FullYear":break;default:return}t=n,r=e.month(),e=29!==(e=e.date())||1!==r||be(t)?e:28,i?s.setUTCFullYear(t,r,e):s.setFullYear(t,r,e)}}function He(e,t){var n;return isNaN(e)||isNaN(t)?NaN:(n=(t%(n=12)+n)%n,e+=(t-n)/12,1==n?be(e)?29:28:31-n%7%2)}x=Array.prototype.indexOf||function(e){for(var t=0;t<this.length;++t)if(this[t]===e)return t;return-1},s("M",["MM",2],"Mo",function(){return this.month()+1}),s("MMM",0,0,function(e){return this.localeData().monthsShort(this,e)}),s("MMMM",0,0,function(e){return this.localeData().months(this,e)}),h("M",n,u),h("MM",n,t),h("MMM",function(e,t){return t.monthsShortRegex(e)}),h("MMMM",function(e,t){return t.monthsRegex(e)}),v(["M","MM"],function(e,t){t[Y]=M(e)-1}),v(["MMM","MMMM"],function(e,t,n,s){s=n._locale.monthsParse(e,s,n._strict);null!=s?t[Y]=s:p(n).invalidMonth=e});var Fe="January_February_March_April_May_June_July_August_September_October_November_December".split("_"),Le="Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),Ve=/D[oD]?(\[[^\[\]]*\]|\s)+MMMM?/,Ge=i,Ee=i;function Ae(e,t){if(e.isValid()){if("string"==typeof t)if(/^\d+$/.test(t))t=M(t);else if(!w(t=e.localeData().monthsParse(t)))return;var n=(n=e.date())<29?n:Math.min(n,He(e.year(),t));e._isUTC?e._d.setUTCMonth(t,n):e._d.setMonth(t,n)}}function Ie(e){return null!=e?(Ae(this,e),_.updateOffset(this,!0),this):Ce(this,"Month")}function je(){function e(e,t){return t.length-e.length}for(var t,n,s=[],i=[],r=[],a=0;a<12;a++)n=l([2e3,a]),t=f(this.monthsShort(n,"")),n=f(this.months(n,"")),s.push(t),i.push(n),r.push(n),r.push(t);s.sort(e),i.sort(e),r.sort(e),this._monthsRegex=new RegExp("^("+r.join("|")+")","i"),this._monthsShortRegex=this._monthsRegex,this._monthsStrictRegex=new RegExp("^("+i.join("|")+")","i"),this._monthsShortStrictRegex=new RegExp("^("+s.join("|")+")","i")}function Ze(e,t,n,s,i,r,a){var o;return e<100&&0<=e?(o=new Date(e+400,t,n,s,i,r,a),isFinite(o.getFullYear())&&o.setFullYear(e)):o=new Date(e,t,n,s,i,r,a),o}function ze(e){var t;return e<100&&0<=e?((t=Array.prototype.slice.call(arguments))[0]=e+400,t=new Date(Date.UTC.apply(null,t)),isFinite(t.getUTCFullYear())&&t.setUTCFullYear(e)):t=new Date(Date.UTC.apply(null,arguments)),t}function qe(e,t,n){n=7+t-n;return n-(7+ze(e,0,n).getUTCDay()-t)%7-1}function $e(e,t,n,s,i){var r,t=1+7*(t-1)+(7+n-s)%7+qe(e,s,i),n=t<=0?We(r=e-1)+t:t>We(e)?(r=e+1,t-We(e)):(r=e,t);return{year:r,dayOfYear:n}}function Be(e,t,n){var s,i,r=qe(e.year(),t,n),r=Math.floor((e.dayOfYear()-r-1)/7)+1;return r<1?s=r+N(i=e.year()-1,t,n):r>N(e.year(),t,n)?(s=r-N(e.year(),t,n),i=e.year()+1):(i=e.year(),s=r),{week:s,year:i}}function N(e,t,n){var s=qe(e,t,n),t=qe(e+1,t,n);return(We(e)-s+t)/7}s("w",["ww",2],"wo","week"),s("W",["WW",2],"Wo","isoWeek"),h("w",n,u),h("ww",n,t),h("W",n,u),h("WW",n,t),Oe(["w","ww","W","WW"],function(e,t,n,s){t[s.substr(0,1)]=M(e)});function Je(e,t){return e.slice(t,7).concat(e.slice(0,t))}s("d",0,"do","day"),s("dd",0,0,function(e){return this.localeData().weekdaysMin(this,e)}),s("ddd",0,0,function(e){return this.localeData().weekdaysShort(this,e)}),s("dddd",0,0,function(e){return this.localeData().weekdays(this,e)}),s("e",0,0,"weekday"),s("E",0,0,"isoWeekday"),h("d",n),h("e",n),h("E",n),h("dd",function(e,t){return t.weekdaysMinRegex(e)}),h("ddd",function(e,t){return t.weekdaysShortRegex(e)}),h("dddd",function(e,t){return t.weekdaysRegex(e)}),Oe(["dd","ddd","dddd"],function(e,t,n,s){s=n._locale.weekdaysParse(e,s,n._strict);null!=s?t.d=s:p(n).invalidWeekday=e}),Oe(["d","e","E"],function(e,t,n,s){t[s]=M(e)});var Qe="Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),Xe="Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),Ke="Su_Mo_Tu_We_Th_Fr_Sa".split("_"),et=i,tt=i,nt=i;function st(){function e(e,t){return t.length-e.length}for(var t,n,s,i=[],r=[],a=[],o=[],u=0;u<7;u++)s=l([2e3,1]).day(u),t=f(this.weekdaysMin(s,"")),n=f(this.weekdaysShort(s,"")),s=f(this.weekdays(s,"")),i.push(t),r.push(n),a.push(s),o.push(t),o.push(n),o.push(s);i.sort(e),r.sort(e),a.sort(e),o.sort(e),this._weekdaysRegex=new RegExp("^("+o.join("|")+")","i"),this._weekdaysShortRegex=this._weekdaysRegex,this._weekdaysMinRegex=this._weekdaysRegex,this._weekdaysStrictRegex=new RegExp("^("+a.join("|")+")","i"),this._weekdaysShortStrictRegex=new RegExp("^("+r.join("|")+")","i"),this._weekdaysMinStrictRegex=new RegExp("^("+i.join("|")+")","i")}function it(){return this.hours()%12||12}function rt(e,t){s(e,0,0,function(){return this.localeData().meridiem(this.hours(),this.minutes(),t)})}function at(e,t){return t._meridiemParse}s("H",["HH",2],0,"hour"),s("h",["hh",2],0,it),s("k",["kk",2],0,function(){return this.hours()||24}),s("hmm",0,0,function(){return""+it.apply(this)+r(this.minutes(),2)}),s("hmmss",0,0,function(){return""+it.apply(this)+r(this.minutes(),2)+r(this.seconds(),2)}),s("Hmm",0,0,function(){return""+this.hours()+r(this.minutes(),2)}),s("Hmmss",0,0,function(){return""+this.hours()+r(this.minutes(),2)+r(this.seconds(),2)}),rt("a",!0),rt("A",!1),h("a",at),h("A",at),h("H",n,d),h("h",n,u),h("k",n,u),h("HH",n,t),h("hh",n,t),h("kk",n,t),h("hmm",me),h("hmmss",_e),h("Hmm",me),h("Hmmss",_e),v(["H","HH"],O),v(["k","kk"],function(e,t,n){e=M(e);t[O]=24===e?0:e}),v(["a","A"],function(e,t,n){n._isPm=n._locale.isPM(e),n._meridiem=e}),v(["h","hh"],function(e,t,n){t[O]=M(e),p(n).bigHour=!0}),v("hmm",function(e,t,n){var s=e.length-2;t[O]=M(e.substr(0,s)),t[b]=M(e.substr(s)),p(n).bigHour=!0}),v("hmmss",function(e,t,n){var s=e.length-4,i=e.length-2;t[O]=M(e.substr(0,s)),t[b]=M(e.substr(s,2)),t[T]=M(e.substr(i)),p(n).bigHour=!0}),v("Hmm",function(e,t,n){var s=e.length-2;t[O]=M(e.substr(0,s)),t[b]=M(e.substr(s))}),v("Hmmss",function(e,t,n){var s=e.length-4,i=e.length-2;t[O]=M(e.substr(0,s)),t[b]=M(e.substr(s,2)),t[T]=M(e.substr(i))});i=Re("Hours",!0);var ot,ut={calendar:{sameDay:"[Today at] LT",nextDay:"[Tomorrow at] LT",nextWeek:"dddd [at] LT",lastDay:"[Yesterday at] LT",lastWeek:"[Last] dddd [at] LT",sameElse:"L"},longDateFormat:{LTS:"h:mm:ss A",LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D, YYYY",LLL:"MMMM D, YYYY h:mm A",LLLL:"dddd, MMMM D, YYYY h:mm A"},invalidDate:"Invalid date",ordinal:"%d",dayOfMonthOrdinalParse:/\d{1,2}/,relativeTime:{future:"in %s",past:"%s ago",s:"a few seconds",ss:"%d seconds",m:"a minute",mm:"%d minutes",h:"an hour",hh:"%d hours",d:"a day",dd:"%d days",w:"a week",ww:"%d weeks",M:"a month",MM:"%d months",y:"a year",yy:"%d years"},months:Fe,monthsShort:Le,week:{dow:0,doy:6},weekdays:Qe,weekdaysMin:Ke,weekdaysShort:Xe,meridiemParse:/[ap]\.?m?\.?/i},W={},lt={};function dt(e){return e&&e.toLowerCase().replace("_","-")}function ht(e){for(var t,n,s,i,r=0;r<e.length;){for(t=(i=dt(e[r]).split("-")).length,n=(n=dt(e[r+1]))?n.split("-"):null;0<t;){if(s=ct(i.slice(0,t).join("-")))return s;if(n&&n.length>=t&&function(e,t){for(var n=Math.min(e.length,t.length),s=0;s<n;s+=1)if(e[s]!==t[s])return s;return n}(i,n)>=t-1)break;t--}r++}return ot}function ct(t){var e,n;if(void 0===W[t]&&"undefined"!=typeof module&&module&&module.exports&&(n=t)&&n.match("^[^/\\\\]*$"))try{e=ot._abbr,require("./locale/"+t),ft(e)}catch(e){W[t]=null}return W[t]}function ft(e,t){return e&&((t=g(t)?P(e):mt(e,t))?ot=t:"undefined"!=typeof console&&console.warn&&console.warn("Locale "+e+" not found. Did you forget to load it?")),ot._abbr}function mt(e,t){if(null===t)return delete W[e],null;var n,s=ut;if(t.abbr=e,null!=W[e])Q("defineLocaleOverride","use moment.updateLocale(localeName, config) to change an existing locale. moment.defineLocale(localeName, config) should only be used for creating a new locale See http://momentjs.com/guides/#/warnings/define-locale/ for more info."),s=W[e]._config;else if(null!=t.parentLocale)if(null!=W[t.parentLocale])s=W[t.parentLocale]._config;else{if(null==(n=ct(t.parentLocale)))return lt[t.parentLocale]||(lt[t.parentLocale]=[]),lt[t.parentLocale].push({name:e,config:t}),null;s=n._config}return W[e]=new K(X(s,t)),lt[e]&&lt[e].forEach(function(e){mt(e.name,e.config)}),ft(e),W[e]}function P(e){var t;if(!(e=e&&e._locale&&e._locale._abbr?e._locale._abbr:e))return ot;if(!y(e)){if(t=ct(e))return t;e=[e]}return ht(e)}function _t(e){var t=e._a;return t&&-2===p(e).overflow&&(t=t[Y]<0||11<t[Y]?Y:t[S]<1||t[S]>He(t[D],t[Y])?S:t[O]<0||24<t[O]||24===t[O]&&(0!==t[b]||0!==t[T]||0!==t[Te])?O:t[b]<0||59<t[b]?b:t[T]<0||59<t[T]?T:t[Te]<0||999<t[Te]?Te:-1,p(e)._overflowDayOfYear&&(t<D||S<t)&&(t=S),p(e)._overflowWeeks&&-1===t&&(t=xe),p(e)._overflowWeekday&&-1===t&&(t=Ne),p(e).overflow=t),e}var yt=/^\s*((?:[+-]\d{6}|\d{4})-(?:\d\d-\d\d|W\d\d-\d|W\d\d|\d\d\d|\d\d))(?:(T| )(\d\d(?::\d\d(?::\d\d(?:[.,]\d+)?)?)?)([+-]\d\d(?::?\d\d)?|\s*Z)?)?$/,gt=/^\s*((?:[+-]\d{6}|\d{4})(?:\d\d\d\d|W\d\d\d|W\d\d|\d\d\d|\d\d|))(?:(T| )(\d\d(?:\d\d(?:\d\d(?:[.,]\d+)?)?)?)([+-]\d\d(?::?\d\d)?|\s*Z)?)?$/,wt=/Z|[+-]\d\d(?::?\d\d)?/,pt=[["YYYYYY-MM-DD",/[+-]\d{6}-\d\d-\d\d/],["YYYY-MM-DD",/\d{4}-\d\d-\d\d/],["GGGG-[W]WW-E",/\d{4}-W\d\d-\d/],["GGGG-[W]WW",/\d{4}-W\d\d/,!1],["YYYY-DDD",/\d{4}-\d{3}/],["YYYY-MM",/\d{4}-\d\d/,!1],["YYYYYYMMDD",/[+-]\d{10}/],["YYYYMMDD",/\d{8}/],["GGGG[W]WWE",/\d{4}W\d{3}/],["GGGG[W]WW",/\d{4}W\d{2}/,!1],["YYYYDDD",/\d{7}/],["YYYYMM",/\d{6}/,!1],["YYYY",/\d{4}/,!1]],kt=[["HH:mm:ss.SSSS",/\d\d:\d\d:\d\d\.\d+/],["HH:mm:ss,SSSS",/\d\d:\d\d:\d\d,\d+/],["HH:mm:ss",/\d\d:\d\d:\d\d/],["HH:mm",/\d\d:\d\d/],["HHmmss.SSSS",/\d\d\d\d\d\d\.\d+/],["HHmmss,SSSS",/\d\d\d\d\d\d,\d+/],["HHmmss",/\d\d\d\d\d\d/],["HHmm",/\d\d\d\d/],["HH",/\d\d/]],Mt=/^\/?Date\((-?\d+)/i,vt=/^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s)?(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{2,4})\s(\d\d):(\d\d)(?::(\d\d))?\s(?:(UT|GMT|[ECMP][SD]T)|([Zz])|([+-]\d{4}))$/,Dt={UT:0,GMT:0,EDT:-240,EST:-300,CDT:-300,CST:-360,MDT:-360,MST:-420,PDT:-420,PST:-480};function Yt(e){var t,n,s,i,r,a,o=e._i,u=yt.exec(o)||gt.exec(o),o=pt.length,l=kt.length;if(u){for(p(e).iso=!0,t=0,n=o;t<n;t++)if(pt[t][1].exec(u[1])){i=pt[t][0],s=!1!==pt[t][2];break}if(null==i)e._isValid=!1;else{if(u[3]){for(t=0,n=l;t<n;t++)if(kt[t][1].exec(u[3])){r=(u[2]||" ")+kt[t][0];break}if(null==r)return void(e._isValid=!1)}if(s||null==r){if(u[4]){if(!wt.exec(u[4]))return void(e._isValid=!1);a="Z"}e._f=i+(r||"")+(a||""),xt(e)}else e._isValid=!1}}else e._isValid=!1}function St(e,t,n,s,i,r){e=[function(e){e=parseInt(e,10);{if(e<=49)return 2e3+e;if(e<=999)return 1900+e}return e}(e),Le.indexOf(t),parseInt(n,10),parseInt(s,10),parseInt(i,10)];return r&&e.push(parseInt(r,10)),e}function Ot(e){var t,n,s=vt.exec(e._i.replace(/\([^()]*\)|[\n\t]/g," ").replace(/(\s\s+)/g," ").replace(/^\s\s*/,"").replace(/\s\s*$/,""));s?(t=St(s[4],s[3],s[2],s[5],s[6],s[7]),function(e,t,n){if(!e||Xe.indexOf(e)===new Date(t[0],t[1],t[2]).getDay())return 1;p(n).weekdayMismatch=!0,n._isValid=!1}(s[1],t,e)&&(e._a=t,e._tzm=(t=s[8],n=s[9],s=s[10],t?Dt[t]:n?0:60*(((t=parseInt(s,10))-(n=t%100))/100)+n),e._d=ze.apply(null,e._a),e._d.setUTCMinutes(e._d.getUTCMinutes()-e._tzm),p(e).rfc2822=!0)):e._isValid=!1}function bt(e,t,n){return null!=e?e:null!=t?t:n}function Tt(e){var t,n,s,i,r,a,o,u,l,d,h,c=[];if(!e._d){for(s=e,i=new Date(_.now()),n=s._useUTC?[i.getUTCFullYear(),i.getUTCMonth(),i.getUTCDate()]:[i.getFullYear(),i.getMonth(),i.getDate()],e._w&&null==e._a[S]&&null==e._a[Y]&&(null!=(i=(s=e)._w).GG||null!=i.W||null!=i.E?(u=1,l=4,r=bt(i.GG,s._a[D],Be(R(),1,4).year),a=bt(i.W,1),((o=bt(i.E,1))<1||7<o)&&(d=!0)):(u=s._locale._week.dow,l=s._locale._week.doy,h=Be(R(),u,l),r=bt(i.gg,s._a[D],h.year),a=bt(i.w,h.week),null!=i.d?((o=i.d)<0||6<o)&&(d=!0):null!=i.e?(o=i.e+u,(i.e<0||6<i.e)&&(d=!0)):o=u),a<1||a>N(r,u,l)?p(s)._overflowWeeks=!0:null!=d?p(s)._overflowWeekday=!0:(h=$e(r,a,o,u,l),s._a[D]=h.year,s._dayOfYear=h.dayOfYear)),null!=e._dayOfYear&&(i=bt(e._a[D],n[D]),(e._dayOfYear>We(i)||0===e._dayOfYear)&&(p(e)._overflowDayOfYear=!0),d=ze(i,0,e._dayOfYear),e._a[Y]=d.getUTCMonth(),e._a[S]=d.getUTCDate()),t=0;t<3&&null==e._a[t];++t)e._a[t]=c[t]=n[t];for(;t<7;t++)e._a[t]=c[t]=null==e._a[t]?2===t?1:0:e._a[t];24===e._a[O]&&0===e._a[b]&&0===e._a[T]&&0===e._a[Te]&&(e._nextDay=!0,e._a[O]=0),e._d=(e._useUTC?ze:Ze).apply(null,c),r=e._useUTC?e._d.getUTCDay():e._d.getDay(),null!=e._tzm&&e._d.setUTCMinutes(e._d.getUTCMinutes()-e._tzm),e._nextDay&&(e._a[O]=24),e._w&&void 0!==e._w.d&&e._w.d!==r&&(p(e).weekdayMismatch=!0)}}function xt(e){if(e._f===_.ISO_8601)Yt(e);else if(e._f===_.RFC_2822)Ot(e);else{e._a=[],p(e).empty=!0;for(var t,n,s,i,r,a=""+e._i,o=a.length,u=0,l=ae(e._f,e._locale).match(te)||[],d=l.length,h=0;h<d;h++)n=l[h],(t=(a.match(De(n,e))||[])[0])&&(0<(s=a.substr(0,a.indexOf(t))).length&&p(e).unusedInput.push(s),a=a.slice(a.indexOf(t)+t.length),u+=t.length),ie[n]?(t?p(e).empty=!1:p(e).unusedTokens.push(n),s=n,r=e,null!=(i=t)&&c(Se,s)&&Se[s](i,r._a,r,s)):e._strict&&!t&&p(e).unusedTokens.push(n);p(e).charsLeftOver=o-u,0<a.length&&p(e).unusedInput.push(a),e._a[O]<=12&&!0===p(e).bigHour&&0<e._a[O]&&(p(e).bigHour=void 0),p(e).parsedDateParts=e._a.slice(0),p(e).meridiem=e._meridiem,e._a[O]=function(e,t,n){if(null==n)return t;return null!=e.meridiemHour?e.meridiemHour(t,n):null!=e.isPM?((e=e.isPM(n))&&t<12&&(t+=12),t=e||12!==t?t:0):t}(e._locale,e._a[O],e._meridiem),null!==(o=p(e).era)&&(e._a[D]=e._locale.erasConvertYear(o,e._a[D])),Tt(e),_t(e)}}function Nt(e){var t,n,s,i=e._i,r=e._f;if(e._locale=e._locale||P(e._l),null===i||void 0===r&&""===i)return I({nullInput:!0});if("string"==typeof i&&(e._i=i=e._locale.preparse(i)),k(i))return new $(_t(i));if(V(i))e._d=i;else if(y(r)){var a,o,u,l,d,h,c=e,f=!1,m=c._f.length;if(0===m)p(c).invalidFormat=!0,c._d=new Date(NaN);else{for(l=0;l<m;l++)d=0,h=!1,a=q({},c),null!=c._useUTC&&(a._useUTC=c._useUTC),a._f=c._f[l],xt(a),A(a)&&(h=!0),d=(d+=p(a).charsLeftOver)+10*p(a).unusedTokens.length,p(a).score=d,f?d<u&&(u=d,o=a):(null==u||d<u||h)&&(u=d,o=a,h)&&(f=!0);E(c,o||a)}}else if(r)xt(e);else if(g(r=(i=e)._i))i._d=new Date(_.now());else V(r)?i._d=new Date(r.valueOf()):"string"==typeof r?(n=i,null!==(t=Mt.exec(n._i))?n._d=new Date(+t[1]):(Yt(n),!1===n._isValid&&(delete n._isValid,Ot(n),!1===n._isValid)&&(delete n._isValid,n._strict?n._isValid=!1:_.createFromInputFallback(n)))):y(r)?(i._a=G(r.slice(0),function(e){return parseInt(e,10)}),Tt(i)):F(r)?(t=i)._d||(s=void 0===(n=ue(t._i)).day?n.date:n.day,t._a=G([n.year,n.month,s,n.hour,n.minute,n.second,n.millisecond],function(e){return e&&parseInt(e,10)}),Tt(t)):w(r)?i._d=new Date(r):_.createFromInputFallback(i);return A(e)||(e._d=null),e}function Wt(e,t,n,s,i){var r={};return!0!==t&&!1!==t||(s=t,t=void 0),!0!==n&&!1!==n||(s=n,n=void 0),(F(e)&&L(e)||y(e)&&0===e.length)&&(e=void 0),r._isAMomentObject=!0,r._useUTC=r._isUTC=i,r._l=n,r._i=e,r._f=t,r._strict=s,(i=new $(_t(Nt(i=r))))._nextDay&&(i.add(1,"d"),i._nextDay=void 0),i}function R(e,t,n,s){return Wt(e,t,n,s,!1)}_.createFromInputFallback=e("value provided is not in a recognized RFC2822 or ISO format. moment construction falls back to js Date(), which is not reliable across all browsers and versions. Non RFC2822/ISO date formats are discouraged. Please refer to http://momentjs.com/guides/#/warnings/js-date/ for more info.",function(e){e._d=new Date(e._i+(e._useUTC?" UTC":""))}),_.ISO_8601=function(){},_.RFC_2822=function(){};me=e("moment().min is deprecated, use moment.max instead. http://momentjs.com/guides/#/warnings/min-max/",function(){var e=R.apply(null,arguments);return this.isValid()&&e.isValid()?e<this?this:e:I()}),_e=e("moment().max is deprecated, use moment.min instead. http://momentjs.com/guides/#/warnings/min-max/",function(){var e=R.apply(null,arguments);return this.isValid()&&e.isValid()?this<e?this:e:I()});function Pt(e,t){var n,s;if(!(t=1===t.length&&y(t[0])?t[0]:t).length)return R();for(n=t[0],s=1;s<t.length;++s)t[s].isValid()&&!t[s][e](n)||(n=t[s]);return n}var Rt=["year","quarter","month","week","day","hour","minute","second","millisecond"];function Ct(e){var e=ue(e),t=e.year||0,n=e.quarter||0,s=e.month||0,i=e.week||e.isoWeek||0,r=e.day||0,a=e.hour||0,o=e.minute||0,u=e.second||0,l=e.millisecond||0;this._isValid=function(e){var t,n,s=!1,i=Rt.length;for(t in e)if(c(e,t)&&(-1===x.call(Rt,t)||null!=e[t]&&isNaN(e[t])))return!1;for(n=0;n<i;++n)if(e[Rt[n]]){if(s)return!1;parseFloat(e[Rt[n]])!==M(e[Rt[n]])&&(s=!0)}return!0}(e),this._milliseconds=+l+1e3*u+6e4*o+1e3*a*60*60,this._days=+r+7*i,this._months=+s+3*n+12*t,this._data={},this._locale=P(),this._bubble()}function Ut(e){return e instanceof Ct}function Ht(e){return e<0?-1*Math.round(-1*e):Math.round(e)}function Ft(e,n){s(e,0,0,function(){var e=this.utcOffset(),t="+";return e<0&&(e=-e,t="-"),t+r(~~(e/60),2)+n+r(~~e%60,2)})}Ft("Z",":"),Ft("ZZ",""),h("Z",ve),h("ZZ",ve),v(["Z","ZZ"],function(e,t,n){n._useUTC=!0,n._tzm=Vt(ve,e)});var Lt=/([\+\-]|\d\d)/gi;function Vt(e,t){var t=(t||"").match(e);return null===t?null:0===(t=60*(e=((t[t.length-1]||[])+"").match(Lt)||["-",0,0])[1]+M(e[2]))?0:"+"===e[0]?t:-t}function Gt(e,t){var n;return t._isUTC?(t=t.clone(),n=(k(e)||V(e)?e:R(e)).valueOf()-t.valueOf(),t._d.setTime(t._d.valueOf()+n),_.updateOffset(t,!1),t):R(e).local()}function Et(e){return-Math.round(e._d.getTimezoneOffset())}function At(){return!!this.isValid()&&this._isUTC&&0===this._offset}_.updateOffset=function(){};var It=/^(-|\+)?(?:(\d*)[. ])?(\d+):(\d+)(?::(\d+)(\.\d*)?)?$/,jt=/^(-|\+)?P(?:([-+]?[0-9,.]*)Y)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)W)?(?:([-+]?[0-9,.]*)D)?(?:T(?:([-+]?[0-9,.]*)H)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)S)?)?$/;function C(e,t){var n,s=e;return Ut(e)?s={ms:e._milliseconds,d:e._days,M:e._months}:w(e)||!isNaN(+e)?(s={},t?s[t]=+e:s.milliseconds=+e):(t=It.exec(e))?(n="-"===t[1]?-1:1,s={y:0,d:M(t[S])*n,h:M(t[O])*n,m:M(t[b])*n,s:M(t[T])*n,ms:M(Ht(1e3*t[Te]))*n}):(t=jt.exec(e))?(n="-"===t[1]?-1:1,s={y:Zt(t[2],n),M:Zt(t[3],n),w:Zt(t[4],n),d:Zt(t[5],n),h:Zt(t[6],n),m:Zt(t[7],n),s:Zt(t[8],n)}):null==s?s={}:"object"==typeof s&&("from"in s||"to"in s)&&(t=function(e,t){var n;if(!e.isValid()||!t.isValid())return{milliseconds:0,months:0};t=Gt(t,e),e.isBefore(t)?n=zt(e,t):((n=zt(t,e)).milliseconds=-n.milliseconds,n.months=-n.months);return n}(R(s.from),R(s.to)),(s={}).ms=t.milliseconds,s.M=t.months),n=new Ct(s),Ut(e)&&c(e,"_locale")&&(n._locale=e._locale),Ut(e)&&c(e,"_isValid")&&(n._isValid=e._isValid),n}function Zt(e,t){e=e&&parseFloat(e.replace(",","."));return(isNaN(e)?0:e)*t}function zt(e,t){var n={};return n.months=t.month()-e.month()+12*(t.year()-e.year()),e.clone().add(n.months,"M").isAfter(t)&&--n.months,n.milliseconds=+t-+e.clone().add(n.months,"M"),n}function qt(s,i){return function(e,t){var n;return null===t||isNaN(+t)||(Q(i,"moment()."+i+"(period, number) is deprecated. Please use moment()."+i+"(number, period). See http://momentjs.com/guides/#/warnings/add-inverted-param/ for more info."),n=e,e=t,t=n),$t(this,C(e,t),s),this}}function $t(e,t,n,s){var i=t._milliseconds,r=Ht(t._days),t=Ht(t._months);e.isValid()&&(s=null==s||s,t&&Ae(e,Ce(e,"Month")+t*n),r&&Ue(e,"Date",Ce(e,"Date")+r*n),i&&e._d.setTime(e._d.valueOf()+i*n),s)&&_.updateOffset(e,r||t)}C.fn=Ct.prototype,C.invalid=function(){return C(NaN)};Fe=qt(1,"add"),Qe=qt(-1,"subtract");function Bt(e){return"string"==typeof e||e instanceof String}function Jt(e){return k(e)||V(e)||Bt(e)||w(e)||function(t){var e=y(t),n=!1;e&&(n=0===t.filter(function(e){return!w(e)&&Bt(t)}).length);return e&&n}(e)||function(e){var t,n,s=F(e)&&!L(e),i=!1,r=["years","year","y","months","month","M","days","day","d","dates","date","D","hours","hour","h","minutes","minute","m","seconds","second","s","milliseconds","millisecond","ms"],a=r.length;for(t=0;t<a;t+=1)n=r[t],i=i||c(e,n);return s&&i}(e)||null==e}function Qt(e,t){var n,s;return e.date()<t.date()?-Qt(t,e):-((n=12*(t.year()-e.year())+(t.month()-e.month()))+(t-(s=e.clone().add(n,"months"))<0?(t-s)/(s-e.clone().add(n-1,"months")):(t-s)/(e.clone().add(1+n,"months")-s)))||0}function Xt(e){return void 0===e?this._locale._abbr:(null!=(e=P(e))&&(this._locale=e),this)}_.defaultFormat="YYYY-MM-DDTHH:mm:ssZ",_.defaultFormatUtc="YYYY-MM-DDTHH:mm:ss[Z]";Ke=e("moment().lang() is deprecated. Instead, use moment().localeData() to get the language configuration. Use moment().locale() to change languages.",function(e){return void 0===e?this.localeData():this.locale(e)});function Kt(){return this._locale}var en=126227808e5;function tn(e,t){return(e%t+t)%t}function nn(e,t,n){return e<100&&0<=e?new Date(e+400,t,n)-en:new Date(e,t,n).valueOf()}function sn(e,t,n){return e<100&&0<=e?Date.UTC(e+400,t,n)-en:Date.UTC(e,t,n)}function rn(e,t){return t.erasAbbrRegex(e)}function an(){for(var e,t,n,s=[],i=[],r=[],a=[],o=this.eras(),u=0,l=o.length;u<l;++u)e=f(o[u].name),t=f(o[u].abbr),n=f(o[u].narrow),i.push(e),s.push(t),r.push(n),a.push(e),a.push(t),a.push(n);this._erasRegex=new RegExp("^("+a.join("|")+")","i"),this._erasNameRegex=new RegExp("^("+i.join("|")+")","i"),this._erasAbbrRegex=new RegExp("^("+s.join("|")+")","i"),this._erasNarrowRegex=new RegExp("^("+r.join("|")+")","i")}function on(e,t){s(0,[e,e.length],0,t)}function un(e,t,n,s,i){var r;return null==e?Be(this,s,i).year:(r=N(e,s,i),function(e,t,n,s,i){e=$e(e,t,n,s,i),t=ze(e.year,0,e.dayOfYear);return this.year(t.getUTCFullYear()),this.month(t.getUTCMonth()),this.date(t.getUTCDate()),this}.call(this,e,t=r<t?r:t,n,s,i))}s("N",0,0,"eraAbbr"),s("NN",0,0,"eraAbbr"),s("NNN",0,0,"eraAbbr"),s("NNNN",0,0,"eraName"),s("NNNNN",0,0,"eraNarrow"),s("y",["y",1],"yo","eraYear"),s("y",["yy",2],0,"eraYear"),s("y",["yyy",3],0,"eraYear"),s("y",["yyyy",4],0,"eraYear"),h("N",rn),h("NN",rn),h("NNN",rn),h("NNNN",function(e,t){return t.erasNameRegex(e)}),h("NNNNN",function(e,t){return t.erasNarrowRegex(e)}),v(["N","NN","NNN","NNNN","NNNNN"],function(e,t,n,s){s=n._locale.erasParse(e,s,n._strict);s?p(n).era=s:p(n).invalidEra=e}),h("y",pe),h("yy",pe),h("yyy",pe),h("yyyy",pe),h("yo",function(e,t){return t._eraYearOrdinalRegex||pe}),v(["y","yy","yyy","yyyy"],D),v(["yo"],function(e,t,n,s){var i;n._locale._eraYearOrdinalRegex&&(i=e.match(n._locale._eraYearOrdinalRegex)),n._locale.eraYearOrdinalParse?t[D]=n._locale.eraYearOrdinalParse(e,i):t[D]=parseInt(e,10)}),s(0,["gg",2],0,function(){return this.weekYear()%100}),s(0,["GG",2],0,function(){return this.isoWeekYear()%100}),on("gggg","weekYear"),on("ggggg","weekYear"),on("GGGG","isoWeekYear"),on("GGGGG","isoWeekYear"),h("G",ke),h("g",ke),h("GG",n,t),h("gg",n,t),h("GGGG",ge,ce),h("gggg",ge,ce),h("GGGGG",we,fe),h("ggggg",we,fe),Oe(["gggg","ggggg","GGGG","GGGGG"],function(e,t,n,s){t[s.substr(0,2)]=M(e)}),Oe(["gg","GG"],function(e,t,n,s){t[s]=_.parseTwoDigitYear(e)}),s("Q",0,"Qo","quarter"),h("Q",de),v("Q",function(e,t){t[Y]=3*(M(e)-1)}),s("D",["DD",2],"Do","date"),h("D",n,u),h("DD",n,t),h("Do",function(e,t){return e?t._dayOfMonthOrdinalParse||t._ordinalParse:t._dayOfMonthOrdinalParseLenient}),v(["D","DD"],S),v("Do",function(e,t){t[S]=M(e.match(n)[0])});ge=Re("Date",!0);s("DDD",["DDDD",3],"DDDo","dayOfYear"),h("DDD",ye),h("DDDD",he),v(["DDD","DDDD"],function(e,t,n){n._dayOfYear=M(e)}),s("m",["mm",2],0,"minute"),h("m",n,d),h("mm",n,t),v(["m","mm"],b);var ln,ce=Re("Minutes",!1),we=(s("s",["ss",2],0,"second"),h("s",n,d),h("ss",n,t),v(["s","ss"],T),Re("Seconds",!1));for(s("S",0,0,function(){return~~(this.millisecond()/100)}),s(0,["SS",2],0,function(){return~~(this.millisecond()/10)}),s(0,["SSS",3],0,"millisecond"),s(0,["SSSS",4],0,function(){return 10*this.millisecond()}),s(0,["SSSSS",5],0,function(){return 100*this.millisecond()}),s(0,["SSSSSS",6],0,function(){return 1e3*this.millisecond()}),s(0,["SSSSSSS",7],0,function(){return 1e4*this.millisecond()}),s(0,["SSSSSSSS",8],0,function(){return 1e5*this.millisecond()}),s(0,["SSSSSSSSS",9],0,function(){return 1e6*this.millisecond()}),h("S",ye,de),h("SS",ye,t),h("SSS",ye,he),ln="SSSS";ln.length<=9;ln+="S")h(ln,pe);function dn(e,t){t[Te]=M(1e3*("0."+e))}for(ln="S";ln.length<=9;ln+="S")v(ln,dn);fe=Re("Milliseconds",!1),s("z",0,0,"zoneAbbr"),s("zz",0,0,"zoneName");u=$.prototype;function hn(e){return e}u.add=Fe,u.calendar=function(e,t){1===arguments.length&&(arguments[0]?Jt(arguments[0])?(e=arguments[0],t=void 0):function(e){for(var t=F(e)&&!L(e),n=!1,s=["sameDay","nextDay","lastDay","nextWeek","lastWeek","sameElse"],i=0;i<s.length;i+=1)n=n||c(e,s[i]);return t&&n}(arguments[0])&&(t=arguments[0],e=void 0):t=e=void 0);var e=e||R(),n=Gt(e,this).startOf("day"),n=_.calendarFormat(this,n)||"sameElse",t=t&&(a(t[n])?t[n].call(this,e):t[n]);return this.format(t||this.localeData().calendar(n,this,R(e)))},u.clone=function(){return new $(this)},u.diff=function(e,t,n){var s,i,r;if(!this.isValid())return NaN;if(!(s=Gt(e,this)).isValid())return NaN;switch(i=6e4*(s.utcOffset()-this.utcOffset()),t=o(t)){case"year":r=Qt(this,s)/12;break;case"month":r=Qt(this,s);break;case"quarter":r=Qt(this,s)/3;break;case"second":r=(this-s)/1e3;break;case"minute":r=(this-s)/6e4;break;case"hour":r=(this-s)/36e5;break;case"day":r=(this-s-i)/864e5;break;case"week":r=(this-s-i)/6048e5;break;default:r=this-s}return n?r:m(r)},u.endOf=function(e){var t,n;if(void 0!==(e=o(e))&&"millisecond"!==e&&this.isValid()){switch(n=this._isUTC?sn:nn,e){case"year":t=n(this.year()+1,0,1)-1;break;case"quarter":t=n(this.year(),this.month()-this.month()%3+3,1)-1;break;case"month":t=n(this.year(),this.month()+1,1)-1;break;case"week":t=n(this.year(),this.month(),this.date()-this.weekday()+7)-1;break;case"isoWeek":t=n(this.year(),this.month(),this.date()-(this.isoWeekday()-1)+7)-1;break;case"day":case"date":t=n(this.year(),this.month(),this.date()+1)-1;break;case"hour":t=this._d.valueOf(),t+=36e5-tn(t+(this._isUTC?0:6e4*this.utcOffset()),36e5)-1;break;case"minute":t=this._d.valueOf(),t+=6e4-tn(t,6e4)-1;break;case"second":t=this._d.valueOf(),t+=1e3-tn(t,1e3)-1;break}this._d.setTime(t),_.updateOffset(this,!0)}return this},u.format=function(e){return e=e||(this.isUtc()?_.defaultFormatUtc:_.defaultFormat),e=re(this,e),this.localeData().postformat(e)},u.from=function(e,t){return this.isValid()&&(k(e)&&e.isValid()||R(e).isValid())?C({to:this,from:e}).locale(this.locale()).humanize(!t):this.localeData().invalidDate()},u.fromNow=function(e){return this.from(R(),e)},u.to=function(e,t){return this.isValid()&&(k(e)&&e.isValid()||R(e).isValid())?C({from:this,to:e}).locale(this.locale()).humanize(!t):this.localeData().invalidDate()},u.toNow=function(e){return this.to(R(),e)},u.get=function(e){return a(this[e=o(e)])?this[e]():this},u.invalidAt=function(){return p(this).overflow},u.isAfter=function(e,t){return e=k(e)?e:R(e),!(!this.isValid()||!e.isValid())&&("millisecond"===(t=o(t)||"millisecond")?this.valueOf()>e.valueOf():e.valueOf()<this.clone().startOf(t).valueOf())},u.isBefore=function(e,t){return e=k(e)?e:R(e),!(!this.isValid()||!e.isValid())&&("millisecond"===(t=o(t)||"millisecond")?this.valueOf()<e.valueOf():this.clone().endOf(t).valueOf()<e.valueOf())},u.isBetween=function(e,t,n,s){return e=k(e)?e:R(e),t=k(t)?t:R(t),!!(this.isValid()&&e.isValid()&&t.isValid())&&("("===(s=s||"()")[0]?this.isAfter(e,n):!this.isBefore(e,n))&&(")"===s[1]?this.isBefore(t,n):!this.isAfter(t,n))},u.isSame=function(e,t){var e=k(e)?e:R(e);return!(!this.isValid()||!e.isValid())&&("millisecond"===(t=o(t)||"millisecond")?this.valueOf()===e.valueOf():(e=e.valueOf(),this.clone().startOf(t).valueOf()<=e&&e<=this.clone().endOf(t).valueOf()))},u.isSameOrAfter=function(e,t){return this.isSame(e,t)||this.isAfter(e,t)},u.isSameOrBefore=function(e,t){return this.isSame(e,t)||this.isBefore(e,t)},u.isValid=function(){return A(this)},u.lang=Ke,u.locale=Xt,u.localeData=Kt,u.max=_e,u.min=me,u.parsingFlags=function(){return E({},p(this))},u.set=function(e,t){if("object"==typeof e)for(var n=function(e){var t,n=[];for(t in e)c(e,t)&&n.push({unit:t,priority:le[t]});return n.sort(function(e,t){return e.priority-t.priority}),n}(e=ue(e)),s=n.length,i=0;i<s;i++)this[n[i].unit](e[n[i].unit]);else if(a(this[e=o(e)]))return this[e](t);return this},u.startOf=function(e){var t,n;if(void 0!==(e=o(e))&&"millisecond"!==e&&this.isValid()){switch(n=this._isUTC?sn:nn,e){case"year":t=n(this.year(),0,1);break;case"quarter":t=n(this.year(),this.month()-this.month()%3,1);break;case"month":t=n(this.year(),this.month(),1);break;case"week":t=n(this.year(),this.month(),this.date()-this.weekday());break;case"isoWeek":t=n(this.year(),this.month(),this.date()-(this.isoWeekday()-1));break;case"day":case"date":t=n(this.year(),this.month(),this.date());break;case"hour":t=this._d.valueOf(),t-=tn(t+(this._isUTC?0:6e4*this.utcOffset()),36e5);break;case"minute":t=this._d.valueOf(),t-=tn(t,6e4);break;case"second":t=this._d.valueOf(),t-=tn(t,1e3);break}this._d.setTime(t),_.updateOffset(this,!0)}return this},u.subtract=Qe,u.toArray=function(){var e=this;return[e.year(),e.month(),e.date(),e.hour(),e.minute(),e.second(),e.millisecond()]},u.toObject=function(){var e=this;return{years:e.year(),months:e.month(),date:e.date(),hours:e.hours(),minutes:e.minutes(),seconds:e.seconds(),milliseconds:e.milliseconds()}},u.toDate=function(){return new Date(this.valueOf())},u.toISOString=function(e){var t;return this.isValid()?(t=(e=!0!==e)?this.clone().utc():this).year()<0||9999<t.year()?re(t,e?"YYYYYY-MM-DD[T]HH:mm:ss.SSS[Z]":"YYYYYY-MM-DD[T]HH:mm:ss.SSSZ"):a(Date.prototype.toISOString)?e?this.toDate().toISOString():new Date(this.valueOf()+60*this.utcOffset()*1e3).toISOString().replace("Z",re(t,"Z")):re(t,e?"YYYY-MM-DD[T]HH:mm:ss.SSS[Z]":"YYYY-MM-DD[T]HH:mm:ss.SSSZ"):null},u.inspect=function(){var e,t,n;return this.isValid()?(t="moment",e="",this.isLocal()||(t=0===this.utcOffset()?"moment.utc":"moment.parseZone",e="Z"),t="["+t+'("]',n=0<=this.year()&&this.year()<=9999?"YYYY":"YYYYYY",this.format(t+n+"-MM-DD[T]HH:mm:ss.SSS"+(e+'[")]'))):"moment.invalid(/* "+this._i+" */)"},"undefined"!=typeof Symbol&&null!=Symbol.for&&(u[Symbol.for("nodejs.util.inspect.custom")]=function(){return"Moment<"+this.format()+">"}),u.toJSON=function(){return this.isValid()?this.toISOString():null},u.toString=function(){return this.clone().locale("en").format("ddd MMM DD YYYY HH:mm:ss [GMT]ZZ")},u.unix=function(){return Math.floor(this.valueOf()/1e3)},u.valueOf=function(){return this._d.valueOf()-6e4*(this._offset||0)},u.creationData=function(){return{input:this._i,format:this._f,locale:this._locale,isUTC:this._isUTC,strict:this._strict}},u.eraName=function(){for(var e,t=this.localeData().eras(),n=0,s=t.length;n<s;++n){if(e=this.clone().startOf("day").valueOf(),t[n].since<=e&&e<=t[n].until)return t[n].name;if(t[n].until<=e&&e<=t[n].since)return t[n].name}return""},u.eraNarrow=function(){for(var e,t=this.localeData().eras(),n=0,s=t.length;n<s;++n){if(e=this.clone().startOf("day").valueOf(),t[n].since<=e&&e<=t[n].until)return t[n].narrow;if(t[n].until<=e&&e<=t[n].since)return t[n].narrow}return""},u.eraAbbr=function(){for(var e,t=this.localeData().eras(),n=0,s=t.length;n<s;++n){if(e=this.clone().startOf("day").valueOf(),t[n].since<=e&&e<=t[n].until)return t[n].abbr;if(t[n].until<=e&&e<=t[n].since)return t[n].abbr}return""},u.eraYear=function(){for(var e,t,n=this.localeData().eras(),s=0,i=n.length;s<i;++s)if(e=n[s].since<=n[s].until?1:-1,t=this.clone().startOf("day").valueOf(),n[s].since<=t&&t<=n[s].until||n[s].until<=t&&t<=n[s].since)return(this.year()-_(n[s].since).year())*e+n[s].offset;return this.year()},u.year=Pe,u.isLeapYear=function(){return be(this.year())},u.weekYear=function(e){return un.call(this,e,this.week(),this.weekday()+this.localeData()._week.dow,this.localeData()._week.dow,this.localeData()._week.doy)},u.isoWeekYear=function(e){return un.call(this,e,this.isoWeek(),this.isoWeekday(),1,4)},u.quarter=u.quarters=function(e){return null==e?Math.ceil((this.month()+1)/3):this.month(3*(e-1)+this.month()%3)},u.month=Ie,u.daysInMonth=function(){return He(this.year(),this.month())},u.week=u.weeks=function(e){var t=this.localeData().week(this);return null==e?t:this.add(7*(e-t),"d")},u.isoWeek=u.isoWeeks=function(e){var t=Be(this,1,4).week;return null==e?t:this.add(7*(e-t),"d")},u.weeksInYear=function(){var e=this.localeData()._week;return N(this.year(),e.dow,e.doy)},u.weeksInWeekYear=function(){var e=this.localeData()._week;return N(this.weekYear(),e.dow,e.doy)},u.isoWeeksInYear=function(){return N(this.year(),1,4)},u.isoWeeksInISOWeekYear=function(){return N(this.isoWeekYear(),1,4)},u.date=ge,u.day=u.days=function(e){var t,n,s;return this.isValid()?(t=Ce(this,"Day"),null!=e?(n=e,s=this.localeData(),e="string"!=typeof n?n:isNaN(n)?"number"==typeof(n=s.weekdaysParse(n))?n:null:parseInt(n,10),this.add(e-t,"d")):t):null!=e?this:NaN},u.weekday=function(e){var t;return this.isValid()?(t=(this.day()+7-this.localeData()._week.dow)%7,null==e?t:this.add(e-t,"d")):null!=e?this:NaN},u.isoWeekday=function(e){var t,n;return this.isValid()?null!=e?(t=e,n=this.localeData(),n="string"==typeof t?n.weekdaysParse(t)%7||7:isNaN(t)?null:t,this.day(this.day()%7?n:n-7)):this.day()||7:null!=e?this:NaN},u.dayOfYear=function(e){var t=Math.round((this.clone().startOf("day")-this.clone().startOf("year"))/864e5)+1;return null==e?t:this.add(e-t,"d")},u.hour=u.hours=i,u.minute=u.minutes=ce,u.second=u.seconds=we,u.millisecond=u.milliseconds=fe,u.utcOffset=function(e,t,n){var s,i=this._offset||0;if(!this.isValid())return null!=e?this:NaN;if(null==e)return this._isUTC?i:Et(this);if("string"==typeof e){if(null===(e=Vt(ve,e)))return this}else Math.abs(e)<16&&!n&&(e*=60);return!this._isUTC&&t&&(s=Et(this)),this._offset=e,this._isUTC=!0,null!=s&&this.add(s,"m"),i!==e&&(!t||this._changeInProgress?$t(this,C(e-i,"m"),1,!1):this._changeInProgress||(this._changeInProgress=!0,_.updateOffset(this,!0),this._changeInProgress=null)),this},u.utc=function(e){return this.utcOffset(0,e)},u.local=function(e){return this._isUTC&&(this.utcOffset(0,e),this._isUTC=!1,e)&&this.subtract(Et(this),"m"),this},u.parseZone=function(){var e;return null!=this._tzm?this.utcOffset(this._tzm,!1,!0):"string"==typeof this._i&&(null!=(e=Vt(Me,this._i))?this.utcOffset(e):this.utcOffset(0,!0)),this},u.hasAlignedHourOffset=function(e){return!!this.isValid()&&(e=e?R(e).utcOffset():0,(this.utcOffset()-e)%60==0)},u.isDST=function(){return this.utcOffset()>this.clone().month(0).utcOffset()||this.utcOffset()>this.clone().month(5).utcOffset()},u.isLocal=function(){return!!this.isValid()&&!this._isUTC},u.isUtcOffset=function(){return!!this.isValid()&&this._isUTC},u.isUtc=At,u.isUTC=At,u.zoneAbbr=function(){return this._isUTC?"UTC":""},u.zoneName=function(){return this._isUTC?"Coordinated Universal Time":""},u.dates=e("dates accessor is deprecated. Use date instead.",ge),u.months=e("months accessor is deprecated. Use month instead",Ie),u.years=e("years accessor is deprecated. Use year instead",Pe),u.zone=e("moment().zone is deprecated, use moment().utcOffset instead. http://momentjs.com/guides/#/warnings/zone/",function(e,t){return null!=e?(this.utcOffset(e="string"!=typeof e?-e:e,t),this):-this.utcOffset()}),u.isDSTShifted=e("isDSTShifted is deprecated. See http://momentjs.com/guides/#/warnings/dst-shifted/ for more information",function(){var e,t;return g(this._isDSTShifted)&&(q(e={},this),(e=Nt(e))._a?(t=(e._isUTC?l:R)(e._a),this._isDSTShifted=this.isValid()&&0<function(e,t,n){for(var s=Math.min(e.length,t.length),i=Math.abs(e.length-t.length),r=0,a=0;a<s;a++)(n&&e[a]!==t[a]||!n&&M(e[a])!==M(t[a]))&&r++;return r+i}(e._a,t.toArray())):this._isDSTShifted=!1),this._isDSTShifted});d=K.prototype;function cn(e,t,n,s){var i=P(),s=l().set(s,t);return i[n](s,e)}function fn(e,t,n){if(w(e)&&(t=e,e=void 0),e=e||"",null!=t)return cn(e,t,n,"month");for(var s=[],i=0;i<12;i++)s[i]=cn(e,i,n,"month");return s}function mn(e,t,n,s){t=("boolean"==typeof e?w(t)&&(n=t,t=void 0):(t=e,e=!1,w(n=t)&&(n=t,t=void 0)),t||"");var i,r=P(),a=e?r._week.dow:0,o=[];if(null!=n)return cn(t,(n+a)%7,s,"day");for(i=0;i<7;i++)o[i]=cn(t,(i+a)%7,s,"day");return o}d.calendar=function(e,t,n){return a(e=this._calendar[e]||this._calendar.sameElse)?e.call(t,n):e},d.longDateFormat=function(e){var t=this._longDateFormat[e],n=this._longDateFormat[e.toUpperCase()];return t||!n?t:(this._longDateFormat[e]=n.match(te).map(function(e){return"MMMM"===e||"MM"===e||"DD"===e||"dddd"===e?e.slice(1):e}).join(""),this._longDateFormat[e])},d.invalidDate=function(){return this._invalidDate},d.ordinal=function(e){return this._ordinal.replace("%d",e)},d.preparse=hn,d.postformat=hn,d.relativeTime=function(e,t,n,s){var i=this._relativeTime[n];return a(i)?i(e,t,n,s):i.replace(/%d/i,e)},d.pastFuture=function(e,t){return a(e=this._relativeTime[0<e?"future":"past"])?e(t):e.replace(/%s/i,t)},d.set=function(e){var t,n;for(n in e)c(e,n)&&(a(t=e[n])?this[n]=t:this["_"+n]=t);this._config=e,this._dayOfMonthOrdinalParseLenient=new RegExp((this._dayOfMonthOrdinalParse.source||this._ordinalParse.source)+"|"+/\d{1,2}/.source)},d.eras=function(e,t){for(var n,s=this._eras||P("en")._eras,i=0,r=s.length;i<r;++i){switch(typeof s[i].since){case"string":n=_(s[i].since).startOf("day"),s[i].since=n.valueOf();break}switch(typeof s[i].until){case"undefined":s[i].until=1/0;break;case"string":n=_(s[i].until).startOf("day").valueOf(),s[i].until=n.valueOf();break}}return s},d.erasParse=function(e,t,n){var s,i,r,a,o,u=this.eras();for(e=e.toUpperCase(),s=0,i=u.length;s<i;++s)if(r=u[s].name.toUpperCase(),a=u[s].abbr.toUpperCase(),o=u[s].narrow.toUpperCase(),n)switch(t){case"N":case"NN":case"NNN":if(a===e)return u[s];break;case"NNNN":if(r===e)return u[s];break;case"NNNNN":if(o===e)return u[s];break}else if(0<=[r,a,o].indexOf(e))return u[s]},d.erasConvertYear=function(e,t){var n=e.since<=e.until?1:-1;return void 0===t?_(e.since).year():_(e.since).year()+(t-e.offset)*n},d.erasAbbrRegex=function(e){return c(this,"_erasAbbrRegex")||an.call(this),e?this._erasAbbrRegex:this._erasRegex},d.erasNameRegex=function(e){return c(this,"_erasNameRegex")||an.call(this),e?this._erasNameRegex:this._erasRegex},d.erasNarrowRegex=function(e){return c(this,"_erasNarrowRegex")||an.call(this),e?this._erasNarrowRegex:this._erasRegex},d.months=function(e,t){return e?(y(this._months)?this._months:this._months[(this._months.isFormat||Ve).test(t)?"format":"standalone"])[e.month()]:y(this._months)?this._months:this._months.standalone},d.monthsShort=function(e,t){return e?(y(this._monthsShort)?this._monthsShort:this._monthsShort[Ve.test(t)?"format":"standalone"])[e.month()]:y(this._monthsShort)?this._monthsShort:this._monthsShort.standalone},d.monthsParse=function(e,t,n){var s,i;if(this._monthsParseExact)return function(e,t,n){var s,i,r,e=e.toLocaleLowerCase();if(!this._monthsParse)for(this._monthsParse=[],this._longMonthsParse=[],this._shortMonthsParse=[],s=0;s<12;++s)r=l([2e3,s]),this._shortMonthsParse[s]=this.monthsShort(r,"").toLocaleLowerCase(),this._longMonthsParse[s]=this.months(r,"").toLocaleLowerCase();return n?"MMM"===t?-1!==(i=x.call(this._shortMonthsParse,e))?i:null:-1!==(i=x.call(this._longMonthsParse,e))?i:null:"MMM"===t?-1!==(i=x.call(this._shortMonthsParse,e))||-1!==(i=x.call(this._longMonthsParse,e))?i:null:-1!==(i=x.call(this._longMonthsParse,e))||-1!==(i=x.call(this._shortMonthsParse,e))?i:null}.call(this,e,t,n);for(this._monthsParse||(this._monthsParse=[],this._longMonthsParse=[],this._shortMonthsParse=[]),s=0;s<12;s++){if(i=l([2e3,s]),n&&!this._longMonthsParse[s]&&(this._longMonthsParse[s]=new RegExp("^"+this.months(i,"").replace(".","")+"$","i"),this._shortMonthsParse[s]=new RegExp("^"+this.monthsShort(i,"").replace(".","")+"$","i")),n||this._monthsParse[s]||(i="^"+this.months(i,"")+"|^"+this.monthsShort(i,""),this._monthsParse[s]=new RegExp(i.replace(".",""),"i")),n&&"MMMM"===t&&this._longMonthsParse[s].test(e))return s;if(n&&"MMM"===t&&this._shortMonthsParse[s].test(e))return s;if(!n&&this._monthsParse[s].test(e))return s}},d.monthsRegex=function(e){return this._monthsParseExact?(c(this,"_monthsRegex")||je.call(this),e?this._monthsStrictRegex:this._monthsRegex):(c(this,"_monthsRegex")||(this._monthsRegex=Ee),this._monthsStrictRegex&&e?this._monthsStrictRegex:this._monthsRegex)},d.monthsShortRegex=function(e){return this._monthsParseExact?(c(this,"_monthsRegex")||je.call(this),e?this._monthsShortStrictRegex:this._monthsShortRegex):(c(this,"_monthsShortRegex")||(this._monthsShortRegex=Ge),this._monthsShortStrictRegex&&e?this._monthsShortStrictRegex:this._monthsShortRegex)},d.week=function(e){return Be(e,this._week.dow,this._week.doy).week},d.firstDayOfYear=function(){return this._week.doy},d.firstDayOfWeek=function(){return this._week.dow},d.weekdays=function(e,t){return t=y(this._weekdays)?this._weekdays:this._weekdays[e&&!0!==e&&this._weekdays.isFormat.test(t)?"format":"standalone"],!0===e?Je(t,this._week.dow):e?t[e.day()]:t},d.weekdaysMin=function(e){return!0===e?Je(this._weekdaysMin,this._week.dow):e?this._weekdaysMin[e.day()]:this._weekdaysMin},d.weekdaysShort=function(e){return!0===e?Je(this._weekdaysShort,this._week.dow):e?this._weekdaysShort[e.day()]:this._weekdaysShort},d.weekdaysParse=function(e,t,n){var s,i;if(this._weekdaysParseExact)return function(e,t,n){var s,i,r,e=e.toLocaleLowerCase();if(!this._weekdaysParse)for(this._weekdaysParse=[],this._shortWeekdaysParse=[],this._minWeekdaysParse=[],s=0;s<7;++s)r=l([2e3,1]).day(s),this._minWeekdaysParse[s]=this.weekdaysMin(r,"").toLocaleLowerCase(),this._shortWeekdaysParse[s]=this.weekdaysShort(r,"").toLocaleLowerCase(),this._weekdaysParse[s]=this.weekdays(r,"").toLocaleLowerCase();return n?"dddd"===t?-1!==(i=x.call(this._weekdaysParse,e))?i:null:"ddd"===t?-1!==(i=x.call(this._shortWeekdaysParse,e))?i:null:-1!==(i=x.call(this._minWeekdaysParse,e))?i:null:"dddd"===t?-1!==(i=x.call(this._weekdaysParse,e))||-1!==(i=x.call(this._shortWeekdaysParse,e))||-1!==(i=x.call(this._minWeekdaysParse,e))?i:null:"ddd"===t?-1!==(i=x.call(this._shortWeekdaysParse,e))||-1!==(i=x.call(this._weekdaysParse,e))||-1!==(i=x.call(this._minWeekdaysParse,e))?i:null:-1!==(i=x.call(this._minWeekdaysParse,e))||-1!==(i=x.call(this._weekdaysParse,e))||-1!==(i=x.call(this._shortWeekdaysParse,e))?i:null}.call(this,e,t,n);for(this._weekdaysParse||(this._weekdaysParse=[],this._minWeekdaysParse=[],this._shortWeekdaysParse=[],this._fullWeekdaysParse=[]),s=0;s<7;s++){if(i=l([2e3,1]).day(s),n&&!this._fullWeekdaysParse[s]&&(this._fullWeekdaysParse[s]=new RegExp("^"+this.weekdays(i,"").replace(".","\\.?")+"$","i"),this._shortWeekdaysParse[s]=new RegExp("^"+this.weekdaysShort(i,"").replace(".","\\.?")+"$","i"),this._minWeekdaysParse[s]=new RegExp("^"+this.weekdaysMin(i,"").replace(".","\\.?")+"$","i")),this._weekdaysParse[s]||(i="^"+this.weekdays(i,"")+"|^"+this.weekdaysShort(i,"")+"|^"+this.weekdaysMin(i,""),this._weekdaysParse[s]=new RegExp(i.replace(".",""),"i")),n&&"dddd"===t&&this._fullWeekdaysParse[s].test(e))return s;if(n&&"ddd"===t&&this._shortWeekdaysParse[s].test(e))return s;if(n&&"dd"===t&&this._minWeekdaysParse[s].test(e))return s;if(!n&&this._weekdaysParse[s].test(e))return s}},d.weekdaysRegex=function(e){return this._weekdaysParseExact?(c(this,"_weekdaysRegex")||st.call(this),e?this._weekdaysStrictRegex:this._weekdaysRegex):(c(this,"_weekdaysRegex")||(this._weekdaysRegex=et),this._weekdaysStrictRegex&&e?this._weekdaysStrictRegex:this._weekdaysRegex)},d.weekdaysShortRegex=function(e){return this._weekdaysParseExact?(c(this,"_weekdaysRegex")||st.call(this),e?this._weekdaysShortStrictRegex:this._weekdaysShortRegex):(c(this,"_weekdaysShortRegex")||(this._weekdaysShortRegex=tt),this._weekdaysShortStrictRegex&&e?this._weekdaysShortStrictRegex:this._weekdaysShortRegex)},d.weekdaysMinRegex=function(e){return this._weekdaysParseExact?(c(this,"_weekdaysRegex")||st.call(this),e?this._weekdaysMinStrictRegex:this._weekdaysMinRegex):(c(this,"_weekdaysMinRegex")||(this._weekdaysMinRegex=nt),this._weekdaysMinStrictRegex&&e?this._weekdaysMinStrictRegex:this._weekdaysMinRegex)},d.isPM=function(e){return"p"===(e+"").toLowerCase().charAt(0)},d.meridiem=function(e,t,n){return 11<e?n?"pm":"PM":n?"am":"AM"},ft("en",{eras:[{since:"0001-01-01",until:1/0,offset:1,name:"Anno Domini",narrow:"AD",abbr:"AD"},{since:"0000-12-31",until:-1/0,offset:1,name:"Before Christ",narrow:"BC",abbr:"BC"}],dayOfMonthOrdinalParse:/\d{1,2}(th|st|nd|rd)/,ordinal:function(e){var t=e%10;return e+(1===M(e%100/10)?"th":1==t?"st":2==t?"nd":3==t?"rd":"th")}}),_.lang=e("moment.lang is deprecated. Use moment.locale instead.",ft),_.langData=e("moment.langData is deprecated. Use moment.localeData instead.",P);var _n=Math.abs;function yn(e,t,n,s){t=C(t,n);return e._milliseconds+=s*t._milliseconds,e._days+=s*t._days,e._months+=s*t._months,e._bubble()}function gn(e){return e<0?Math.floor(e):Math.ceil(e)}function wn(e){return 4800*e/146097}function pn(e){return 146097*e/4800}function kn(e){return function(){return this.as(e)}}de=kn("ms"),t=kn("s"),ye=kn("m"),he=kn("h"),Fe=kn("d"),_e=kn("w"),me=kn("M"),Qe=kn("Q"),i=kn("y"),ce=de;function Mn(e){return function(){return this.isValid()?this._data[e]:NaN}}var we=Mn("milliseconds"),fe=Mn("seconds"),ge=Mn("minutes"),Pe=Mn("hours"),d=Mn("days"),vn=Mn("months"),Dn=Mn("years");var Yn=Math.round,Sn={ss:44,s:45,m:45,h:22,d:26,w:null,M:11};function On(e,t,n,s){var i=C(e).abs(),r=Yn(i.as("s")),a=Yn(i.as("m")),o=Yn(i.as("h")),u=Yn(i.as("d")),l=Yn(i.as("M")),d=Yn(i.as("w")),i=Yn(i.as("y")),r=(r<=n.ss?["s",r]:r<n.s&&["ss",r])||(a<=1?["m"]:a<n.m&&["mm",a])||(o<=1?["h"]:o<n.h&&["hh",o])||(u<=1?["d"]:u<n.d&&["dd",u]);return(r=(r=null!=n.w?r||(d<=1?["w"]:d<n.w&&["ww",d]):r)||(l<=1?["M"]:l<n.M&&["MM",l])||(i<=1?["y"]:["yy",i]))[2]=t,r[3]=0<+e,r[4]=s,function(e,t,n,s,i){return i.relativeTime(t||1,!!n,e,s)}.apply(null,r)}var bn=Math.abs;function Tn(e){return(0<e)-(e<0)||+e}function xn(){var e,t,n,s,i,r,a,o,u,l,d;return this.isValid()?(e=bn(this._milliseconds)/1e3,t=bn(this._days),n=bn(this._months),(o=this.asSeconds())?(s=m(e/60),i=m(s/60),e%=60,s%=60,r=m(n/12),n%=12,a=e?e.toFixed(3).replace(/\.?0+$/,""):"",u=Tn(this._months)!==Tn(o)?"-":"",l=Tn(this._days)!==Tn(o)?"-":"",d=Tn(this._milliseconds)!==Tn(o)?"-":"",(o<0?"-":"")+"P"+(r?u+r+"Y":"")+(n?u+n+"M":"")+(t?l+t+"D":"")+(i||s||e?"T":"")+(i?d+i+"H":"")+(s?d+s+"M":"")+(e?d+a+"S":"")):"P0D"):this.localeData().invalidDate()}var U=Ct.prototype;return U.isValid=function(){return this._isValid},U.abs=function(){var e=this._data;return this._milliseconds=_n(this._milliseconds),this._days=_n(this._days),this._months=_n(this._months),e.milliseconds=_n(e.milliseconds),e.seconds=_n(e.seconds),e.minutes=_n(e.minutes),e.hours=_n(e.hours),e.months=_n(e.months),e.years=_n(e.years),this},U.add=function(e,t){return yn(this,e,t,1)},U.subtract=function(e,t){return yn(this,e,t,-1)},U.as=function(e){if(!this.isValid())return NaN;var t,n,s=this._milliseconds;if("month"===(e=o(e))||"quarter"===e||"year"===e)switch(t=this._days+s/864e5,n=this._months+wn(t),e){case"month":return n;case"quarter":return n/3;case"year":return n/12}else switch(t=this._days+Math.round(pn(this._months)),e){case"week":return t/7+s/6048e5;case"day":return t+s/864e5;case"hour":return 24*t+s/36e5;case"minute":return 1440*t+s/6e4;case"second":return 86400*t+s/1e3;case"millisecond":return Math.floor(864e5*t)+s;default:throw new Error("Unknown unit "+e)}},U.asMilliseconds=de,U.asSeconds=t,U.asMinutes=ye,U.asHours=he,U.asDays=Fe,U.asWeeks=_e,U.asMonths=me,U.asQuarters=Qe,U.asYears=i,U.valueOf=ce,U._bubble=function(){var e=this._milliseconds,t=this._days,n=this._months,s=this._data;return 0<=e&&0<=t&&0<=n||e<=0&&t<=0&&n<=0||(e+=864e5*gn(pn(n)+t),n=t=0),s.milliseconds=e%1e3,e=m(e/1e3),s.seconds=e%60,e=m(e/60),s.minutes=e%60,e=m(e/60),s.hours=e%24,t+=m(e/24),n+=e=m(wn(t)),t-=gn(pn(e)),e=m(n/12),n%=12,s.days=t,s.months=n,s.years=e,this},U.clone=function(){return C(this)},U.get=function(e){return e=o(e),this.isValid()?this[e+"s"]():NaN},U.milliseconds=we,U.seconds=fe,U.minutes=ge,U.hours=Pe,U.days=d,U.weeks=function(){return m(this.days()/7)},U.months=vn,U.years=Dn,U.humanize=function(e,t){var n,s;return this.isValid()?(n=!1,s=Sn,"object"==typeof e&&(t=e,e=!1),"boolean"==typeof e&&(n=e),"object"==typeof t&&(s=Object.assign({},Sn,t),null!=t.s)&&null==t.ss&&(s.ss=t.s-1),e=this.localeData(),t=On(this,!n,s,e),n&&(t=e.pastFuture(+this,t)),e.postformat(t)):this.localeData().invalidDate()},U.toISOString=xn,U.toString=xn,U.toJSON=xn,U.locale=Xt,U.localeData=Kt,U.toIsoString=e("toIsoString() is deprecated. Please use toISOString() instead (notice the capitals)",xn),U.lang=Ke,s("X",0,0,"unix"),s("x",0,0,"valueOf"),h("x",ke),h("X",/[+-]?\d+(\.\d{1,3})?/),v("X",function(e,t,n){n._d=new Date(1e3*parseFloat(e))}),v("x",function(e,t,n){n._d=new Date(M(e))}),_.version="2.30.1",H=R,_.fn=u,_.min=function(){return Pt("isBefore",[].slice.call(arguments,0))},_.max=function(){return Pt("isAfter",[].slice.call(arguments,0))},_.now=function(){return Date.now?Date.now():+new Date},_.utc=l,_.unix=function(e){return R(1e3*e)},_.months=function(e,t){return fn(e,t,"months")},_.isDate=V,_.locale=ft,_.invalid=I,_.duration=C,_.isMoment=k,_.weekdays=function(e,t,n){return mn(e,t,n,"weekdays")},_.parseZone=function(){return R.apply(null,arguments).parseZone()},_.localeData=P,_.isDuration=Ut,_.monthsShort=function(e,t){return fn(e,t,"monthsShort")},_.weekdaysMin=function(e,t,n){return mn(e,t,n,"weekdaysMin")},_.defineLocale=mt,_.updateLocale=function(e,t){var n,s;return null!=t?(s=ut,null!=W[e]&&null!=W[e].parentLocale?W[e].set(X(W[e]._config,t)):(t=X(s=null!=(n=ct(e))?n._config:s,t),null==n&&(t.abbr=e),(s=new K(t)).parentLocale=W[e],W[e]=s),ft(e)):null!=W[e]&&(null!=W[e].parentLocale?(W[e]=W[e].parentLocale,e===ft()&&ft(e)):null!=W[e]&&delete W[e]),W[e]},_.locales=function(){return ee(W)},_.weekdaysShort=function(e,t,n){return mn(e,t,n,"weekdaysShort")},_.normalizeUnits=o,_.relativeTimeRounding=function(e){return void 0===e?Yn:"function"==typeof e&&(Yn=e,!0)},_.relativeTimeThreshold=function(e,t){return void 0!==Sn[e]&&(void 0===t?Sn[e]:(Sn[e]=t,"s"===e&&(Sn.ss=t-1),!0))},_.calendarFormat=function(e,t){return(e=e.diff(t,"days",!0))<-6?"sameElse":e<-1?"lastWeek":e<0?"lastDay":e<1?"sameDay":e<2?"nextDay":e<7?"nextWeek":"sameElse"},_.prototype=u,_.HTML5_FMT={DATETIME_LOCAL:"YYYY-MM-DDTHH:mm",DATETIME_LOCAL_SECONDS:"YYYY-MM-DDTHH:mm:ss",DATETIME_LOCAL_MS:"YYYY-MM-DDTHH:mm:ss.SSS",DATE:"YYYY-MM-DD",TIME:"HH:mm",TIME_SECONDS:"HH:mm:ss",TIME_MS:"HH:mm:ss.SSS",WEEK:"GGGG-[W]WW",MONTH:"YYYY-MM"},_});;
IRON.previousTrackThreshold = 2; //The number of seconds a track must play before the "Previous" button resets the track to the beginning.

IRON.audioPlayer = (function ($) {
  "use strict";
  var autoplayEnable;

  function initPlayer(player) {
    var audioPlayer = player;
    audioPlayer.id = audioPlayer.data("id");
    audioPlayer.hide_progressbar = audioPlayer.data("hide-progressbar") ? true : false;
    this.audioPlayer = player;
    var waveContainer = this.audioPlayer.find(".player .wave").attr("id");
    var playlist = audioPlayer.find(".playlist");
    this.playlist = playlist;
    this.autoplayEnable = audioPlayer.data("autoplay");
    audioPlayer.progressType = audioPlayer.data("progress-bar-style");

    audioPlayer.list = {};
    audioPlayer.list.tracks = [];

    playlist.find(".sr-playlist-item").each(function () {
        var $track = $(this);
        var trackData = {
            peakFile:             $track.data("peakfile"),
            mp3:                  $track.data("audiopath"),
            sourcePostID:         $track.data("post-id"),
            id:                   $track.data("trackid"), // Its the media attachment ID if set.
            track_pos:            $track.data("track-pos"),
            isPreview:            $track.data("is-preview"),
            peak_allow_frontend:  $track.data("peakfile-allow"),
        };
        audioPlayer.list.tracks.push(trackData);
    });

    $(audioPlayer).css("opacity", 1);

    fetch(this.audioPlayer.attr('data-url-playlist')) // Call the fetch function passing the playlist.json as audioplayer.list parameters
    .then(response => {
      if (!response.ok) {
        throw new Error('Network error: ' + response.status);
      }
      return response.json();
    })
    .then(data => {
      this.audioPlayer.list = data;
    })
    .catch(error => {
      console.error('There was a problem retrieving the data: ', error);
    });
    
    this.$audio_el = $("#" + waveContainer).find(".sonaar_media_element")[0];
    
   
    fakeWaveUpdate(this.$audio_el, audioPlayer, playlist);
    $(audioPlayer).find(".wave").css("opacity", "1");
    
    setPlaylist(playlist, this.$audio_el, audioPlayer);

    var trackNumber = playlist.find("li").index();
    var track = playlist.find("li").eq(trackNumber);
    if(track.data('tracktime')){
      audioPlayer.find('.totalTime').text('-' + track.data('tracktime'));
    }

    setCurrentTrack(playlist.find("li").eq(0), playlist.find("li").index(), audioPlayer, this.$audio_el);
    setControl(this.$audio_el, audioPlayer, playlist);
    if(track.data('tracktime')){
      audioPlayer.find('.totalTime').text('-' + track.data('tracktime'));
    }
    sr_playerCTAresponsive();
  }

  var triggerPlay = function ($audio_el, audioPlayer) {
    $audio_el.play();
    togglePlaying(audioPlayer, $audio_el);
  };

  function setCurrentTrack(track, index, audioPlayer, $audio_el) {
    audioPlayer.currentTrack = index; 
    var albumArt = audioPlayer.find(".album .album-art");
    var album = audioPlayer.find(".album");
    var trackTitle = audioPlayer.find(".track-title");
    var trackTime = audioPlayer.find(".track-time");
    var trackArtist = audioPlayer.find(".sr_it-artists-value");
    var albumTitle = audioPlayer.find(".sr_it-playlist-title, .album-title");
    var albumReleaseDate = audioPlayer.find(".srp_subtitle");

    if (audioPlayer.data('hide-artwork') != '1' && audioPlayer.data('hide-artwork') != 'true') {
      if (track.data("albumart")) {
        audioPlayer.removeClass('sonaar-no-artwork');
        if (albumArt.find("img").length) {
          albumArt.find("img").attr("src", track.data("albumart"));
        } else {
          albumArt.css("background-image", "url(" + track.data("albumart") + ")");
        }
      } else {
        audioPlayer.addClass('sonaar-no-artwork');
      }
    }

    audioPlayer.data("currentTrack", index);
    trackTitle.html(track.data("tracktitle"));
    trackTime.text(track.data("tracktime"));
    trackArtist.text(track.data("trackartists"));
    albumReleaseDate.text(track.data("releasedate"));
    if (audioPlayer.data("playlist_title").length) {
      albumTitle.text(audioPlayer.data("playlist_title"));
    } else {
      albumTitle.text(track.data("albumtitle"));
    }

    if (audioPlayer.data('playertemplate') == 'skin_boxed_tracklist' && audioPlayer.find('.srp_track_cta').length) {
      audioPlayer.find('.srp_track_cta .song-store-list-container').remove();
      audioPlayer.find('.srp_track_cta').append(track.find('.song-store-list-container').clone());
    }

    audioPlayer.find(".player").removeClass("hide");

    audioPlayer.find(".wave").removeClass("reveal");

    if (!track.data("showloading")) {
      audioPlayer.find(".player").addClass("hide");
    } else {
      audioPlayer.find(".progressLoading").css("opacity", "0.75");
    }

    IRON.createFakeWave(audioPlayer);
    
    setTime(audioPlayer, $audio_el);

    hideEmptyAttribut(track.data("releasedate"), audioPlayer.find(".srp_subtitle"));
  }

  function setPlaylist(playlist, $audio_el, audioPlayer) {
    let playlistTimeDuration = 0;
    playlist.find("li").each(function () {

      setSingleTrack($(this), $(this).index(), $audio_el, audioPlayer);

      if ($(this).data('relatedtrack') != '1') { //Count playlist time duration
        if ($(this).data('tracktime')) {
          convertTime($(this).data('tracktime'));
          playlistTimeDuration = playlistTimeDuration + convertTime($(this).data('tracktime'));
        } else { // Hide playlist time duration if one track doesnt have time (streaming)
          audioPlayer.find('.srp_playlist_duration').hide();
        }
      }

    });
    //Output playlist time duration
    playlistTimeDuration = Math.round(playlistTimeDuration / 60) * 60; //Round to minutes
    playlistTimeDuration = moment.duration(playlistTimeDuration, "seconds");
    let durationOutput = (playlistTimeDuration.hours() > 0) ? playlistTimeDuration.hours() + ' ' + audioPlayer.find('.srp_playlist_duration').data('hours-label') + ' ' : '';
    durationOutput = durationOutput + playlistTimeDuration.minutes() + ' ' + audioPlayer.find('.srp_playlist_duration').data('minutes-label');
    audioPlayer.find('.srp_playlist_duration').html(durationOutput);
  }

  function setTime(audioPlayer, $audio_el) {
    $($audio_el).on("timeupdate", function () {
      var currentTime = $audio_el.currentTime;
      var time = moment.duration(currentTime, "seconds");
      if (time.hours() >= 12 || time.hours() <= 0) {
        audioPlayer.find(".currentTime").html(moment(time.minutes() + ":" + time.seconds(), "m:s").format("mm:ss"));
      } else {
        audioPlayer.find(".currentTime").html(moment(time.hours() + ":" + time.minutes() + ":" + time.seconds(), "h:m:s").format("h:mm:ss"));
      }
      if ($audio_el.duration !== Infinity) {
        var timeLeft = moment.duration($audio_el.duration - $audio_el.currentTime, "seconds");
        if(timeLeft.milliseconds() > 0){
          if (timeLeft.hours() >= 12 || timeLeft.hours() <= 0) {
            audioPlayer.find(".totalTime").html("-" + moment(timeLeft.minutes() + ":" + timeLeft.seconds(), "m:s").format("mm:ss"));
          } else {
            audioPlayer.find(".totalTime").html("-" + moment(timeLeft.hours() + ":" + timeLeft.minutes() + ":" + timeLeft.seconds(), "h:m:s").format("h:mm:ss"));
          }
        }else{
          audioPlayer.find(".totalTime").html("");
        }
      } else {
        audioPlayer.find(".totalTime").html("");
      }
    });
    
  }

  function setControl($audio_el, audioPlayer, playlist) {
    // var ctrl = audioPlayer.find('.control');
    audioPlayer.unbind('click');
    audioPlayer.on("click", ".play, .album .album-art", function (event) {
      togglePause();

      if (!audioPlayer.hasClass("audio-playing")) {
        if($($audio_el).attr('src') != ''){
          play(audioPlayer, $audio_el);
          triggerPlay($audio_el, audioPlayer);
        } else {
          playlist.find("li").eq(0).find("a.audio-track").click();
        }
      } else {
        togglePause();
      }
      togglePlaying(audioPlayer, $audio_el);
      event.preventDefault();
    });
    audioPlayer.on("click", ".previous", function (event) {
      previous(audioPlayer, $audio_el, playlist);
      event.preventDefault();
    });
    audioPlayer.on("click", ".next", function (event) {
      next(audioPlayer, $audio_el, playlist);
      event.preventDefault();
    });
    audioPlayer.on('mouseenter', '.sr-playlist-item .song-store-list-menu', function () {
      openStoreListContainer(this);
    });
    audioPlayer.on('mouseleave', '.sr-playlist-item .song-store-list-container', function () {
      closeStoreListContainer(this);
    });
  }

  function setSingleTrack(singleTrack, eq, $audio_el, audioPlayer) {
    singleTrack.find(".audio-track").remove();
    var tracknumber = eq + 1;
    var trackplay = $("<span/>", {
      class: "track-number",
      html:
        '<span class="number">' +
        tracknumber +
        '</span><i class="sricon-play"></i>',
    });
    $("");
    $("<a/>", {
      class: "audio-track",
      click: function (event) {
        if ($(this).parents('.sr-playlist-item').attr("data-audiopath").length == 0) {
          return;
        }

        if (ifTrackIsPlaying($audio_el) && singleTrack.hasClass("current")) {
          togglePause();
          togglePlaying(audioPlayer, $audio_el);
        } else if (singleTrack.hasClass("current")) {
          play(audioPlayer, $audio_el);
        } else {
          togglePause();
          setCurrentTrack(singleTrack, eq, audioPlayer, $audio_el);
          setAudio(singleTrack.data("audiopath"), $audio_el, audioPlayer);
          
          audioPlayer.find(".playlist li").removeClass("current");
          singleTrack.addClass("current");
          triggerPlay($audio_el, audioPlayer);
          togglePlaying(audioPlayer, $audio_el);
        }
        IRON.init_generatePeaks(audioPlayer);
        event.preventDefault();
      },
    })
      .appendTo(singleTrack)
      .prepend(trackplay)
      .append('<div class="tracklist-item-title">' + singleTrack.data("tracktitle") + ' </div><span class="tracklist-item-time">' + singleTrack.data("tracktime") + "</span>");
    singleTrack.find('.store-list').before(singleTrack.find(".audio-track"));
  }

  var setAudio = function (audio, $audio_el) {
    $($audio_el).attr("src", audio);
    $audio_el.load();

    $(".sonaar_fake_wave").on("click", function (event) {
      var currentAudio = $(this).find(".sonaar_media_element")[0];
      var progressedAudio = $(this).width() / event.offsetX;
      const duration = (currentAudio.duration == 'Infinity')? currentAudio.buffered.end(currentAudio.buffered.length-1) : currentAudio.duration;
      currentAudio.currentTime = duration / progressedAudio;
      event.preventDefault();
    });
  };

  function togglePlaying(audioPlayer, $audio_el) {
    $.each(IRON.players, function () {
      this.audioPlayer.removeClass("audio-playing");
    });

    if (ifTrackIsPlaying($audio_el)) {
      audioPlayer.addClass("audio-playing");
      audioPlayer.find('.currentTime, .totalTime').show();
      return;
    }

    audioPlayer.removeClass("audio-playing");
  }

  function togglePause() {
    $.each(IRON.players, function () {
      if (ifTrackIsPlaying(this.$audio_el)) {
        this.$audio_el.pause();
      }
    });
  }

  function play(audioPlayer, $audio_el) {
    IRON.init_generatePeaks(audioPlayer);
    if (!audioPlayer.find(".playlist li").hasClass("current")) {
      audioPlayer.find("li:first-of-type").addClass("current");
    }
    if (ifTrackIsPlaying($audio_el)) {
      $audio_el.pause();
    } else {
      $audio_el.play();
    }
    togglePlaying(audioPlayer, $audio_el);
  }

  function previous(audioPlayer, $audio_el, playlist) {
    if( $audio_el.currentTime > IRON.previousTrackThreshold ){ //Resets the track to the beginning Or go to the previous track.
        $audio_el.currentTime = 0;
        return;
    }

    var currentTrack = audioPlayer.data("currentTrack");
    var nextTrack = currentTrack - 1;
    playlist.find("li").eq(nextTrack).find("a.audio-track").click();
  }

  function next(audioPlayer, $audio_el, playlist) {
    var currentTrack = audioPlayer.data("currentTrack");
    var nextTrack = currentTrack + 1;

    if (!playlist.find("li").eq(nextTrack).length) {
      nextTrack = 0;
    }
    $audio_el.pause();
    playlist.find("li").eq(nextTrack).find("a.audio-track").click();
  }

  function getPlayer() {
    return this;
  }

  function getplay() {
    play(this.audioPlayer, this.$audio_el);
  }

  function ifTrackIsPlaying($audio_el) {
      return !$audio_el.paused;
  }

  var fakeWaveUpdate = function ($audio_el, audioPlayer, playlist) {
    $($audio_el).on("timeupdate", function () {
      const duration = (this.duration == 'Infinity')? this.buffered.end(this.buffered.length-1) : this.duration;
      $(audioPlayer)
        .find(".sonaar_wave_cut")
        .width(((this.currentTime + 0.35) / duration) * 100 + "%");
      if ($audio_el.ended) {
        //When track ended
        next(audioPlayer, $audio_el, playlist);
      }
    });
  };

  return {
    init: initPlayer,
    getPlayer: getPlayer,
    play: getplay,
    autoplayEnable: autoplayEnable,
    triggerPlay: triggerPlay,
  };
})(jQuery);

function hideEmptyAttribut(string, selector) {
  if (string == "") {
    selector.css("display", "none");
  } else {
    selector.css("display", "block");
  }
}


//Load Music player Content
function setIronAudioplayers(specificParentSelector) {
  if (typeof specificParentSelector !== "undefined") {
    // set all audioplayers or only players inide a specific selector
    if (!specificParentSelector.includes('"') && !specificParentSelector.includes("'") && jQuery('[data-id="' + specificParentSelector + '"]').hasClass('iron-audioplayer')) { //if specificParentSelector is the iron-audioplayer element (not parent)
      var playerSelector = jQuery('[data-id="' + specificParentSelector + '"]');
    } else {
      var playerSelector = jQuery(specificParentSelector + " .iron-audioplayer");
    }

    if (IRON.players == "undefined") {
      IRON.players = []; //dont reset the IRON.players if they already exist and the setIronAudioplayers function is executed from sr-scripts.js
    }
  } else {
    var playerSelector = jQuery(".iron-audioplayer");
    IRON.players = [];
  }
  playerSelector.each(function () {

    if (typeof specificParentSelector == "undefined" && jQuery(this).parents(".elementor-widget-woocommerce-products").length) return;

    if (typeof specificParentSelector == "undefined" && jQuery(this).parents(".elementor-widget-music-player").length) return;
    var player = Object.create(IRON.audioPlayer);
    player.init(jQuery(this));
    IRON.players.push(player);
  });
}
setIronAudioplayers();
;
/**
* @preserve Sticky Anything 2.1.1 | (c) WebFactory Ltd | GPL2 Licensed
*/

(function($) {
	$(document).ready(function($) {

		var thisIsSomeBreakpoint = '' // solely to use as a debugging breakpoint, if needed.

		$(sticky_anything_engage.element).stickThis({
			top:sticky_anything_engage.topspace,
			minscreenwidth:sticky_anything_engage.minscreenwidth,
			maxscreenwidth:sticky_anything_engage.maxscreenwidth,
			zindex:sticky_anything_engage.zindex,
			legacymode:sticky_anything_engage.legacymode,
			dynamicmode:sticky_anything_engage.dynamicmode,
			debugmode:sticky_anything_engage.debugmode,
			pushup:sticky_anything_engage.pushup,
			adminbar:sticky_anything_engage.adminbar
		});

	});
}(jQuery));
;
!function(){"use strict";var e,t={noop:function(){},texturize:function(e){return(e=(e=(e=(e+="").replace(/'/g,"&#8217;").replace(/&#039;/g,"&#8217;")).replace(/"/g,"&#8221;").replace(/&#034;/g,"&#8221;").replace(/&quot;/g,"&#8221;").replace(/[\u201D]/g,"&#8221;")).replace(/([\w]+)=&#[\d]+;(.+?)&#[\d]+;/g,'$1="$2"')).trim()},applyReplacements:function(e,t){if(e)return t?e.replace(/{(\d+)}/g,function(e,r){return void 0!==t[r]?t[r]:e}):e},getBackgroundImage:function(e){var t=document.createElement("canvas"),r=t.getContext&&t.getContext("2d");if(e){r.filter="blur(20px) ",r.drawImage(e,0,0);var o=t.toDataURL("image/png");return t=null,o}}},r=function(){function e(e,t){return Element.prototype.matches?e.matches(t):Element.prototype.msMatchesSelector?e.msMatchesSelector(t):void 0}function r(e,t,r,o){if(!e)return o();e.jpCarouselCancelFade&&e.jpCarouselCancelFade(),e.classList.remove("jp-carousel-fade"),e.style.removeProperty("display"),e.style.opacity=t,e.style.pointerEvents="none",e.offsetWidth,e.classList.add("jp-carousel-fade"),e.style.opacity=r;var a=1e3*parseFloat(getComputedStyle(e).transitionDuration)||0,n=setTimeout(function(){e.jpCarouselCancelFade=null,e.style.removeProperty("pointer-events"),o()},a+50);e.jpCarouselCancelFade=function(){clearTimeout(n),e.jpCarouselCancelFade=null}}return{closest:function(t,r){if(t.closest)return t.closest(r);var o=t;do{if(e(o,r))return o;o=o.parentElement||o.parentNode}while(null!==o&&1===o.nodeType);return null},matches:e,hide:function(e){e&&(e.style.display="none")},show:function(e){e&&(e.style.display="block")},fadeIn:function(e,o){r(e,0,1,o=o||t.noop)},fadeOut:function(e,o){o=o||t.noop,r(e,1,0,function(){e&&(e.style.display="none"),o()})},scrollToElement:function(e,t,r){if(!e||!t)return r?r():void 0;var o=t.querySelector(".jp-carousel-info-extra");o&&(o.style.minHeight=window.innerHeight-64+"px");var a=!0,n=Date.now(),i=t.scrollTop,l=Math.max(0,e.offsetTop-Math.max(0,window.innerHeight-function(e){var t=e.querySelector(".jp-carousel-info-footer"),r=e.querySelector(".jp-carousel-info-extra"),o=e.querySelector(".jp-carousel-info-content-wrapper");if(t&&r&&o){var a=window.getComputedStyle(r),n=parseInt(a.paddingTop,10)+parseInt(a.paddingBottom,10);return n=isNaN(n)?0:n,o.offsetHeight+t.offsetHeight+n}return 0}(t)))-t.scrollTop;function s(){a=!1}l=Math.min(l,t.scrollHeight-window.innerHeight),t.addEventListener("wheel",s),function e(){var c,u=Date.now(),d=(c=(u-n)/300)<.5?2*c*c:1-Math.pow(-2*c+2,2)/2,m=(d=d>1?1:d)*l;if(t.scrollTop=i+m,u<=n+300&&a)return requestAnimationFrame(e);r&&r(),o&&(o.style.minHeight=""),a=!1,t.removeEventListener("wheel",s)}()},getJSONAttribute:function(e,t){if(e&&e.hasAttribute(t))try{return JSON.parse(e.getAttribute(t))}catch{return}},convertToPlainText:function(e){var t=document.createElement("div");return t.textContent=e,t.innerHTML},stripHTML:function(e){var t=document.createElement("div");return t.innerHTML=e.replace(/<[^>]*>?/gm,""),t.textContent},emitEvent:function(e,t,r){var o;try{o=new CustomEvent(t,{bubbles:!0,cancelable:!0,detail:r||null})}catch{(o=document.createEvent("CustomEvent")).initCustomEvent(t,!0,!0,r||null)}e.dispatchEvent(o)},isTouch:function(){return"ontouchstart"in window||window.DocumentTouch&&document instanceof DocumentTouch},prefersReducedMotion:function(){return!!window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches}}}();function o(){var o,a,n,i,l={},s={},c="",u=!1,d="div.gallery, div.tiled-gallery, ul.wp-block-gallery, ul.blocks-gallery-grid, figure.wp-block-gallery.has-nested-images, div.wp-block-jetpack-tiled-gallery, a.single-image-gallery",m=".gallery-item, .tiled-gallery-item, .blocks-gallery-item,  .tiled-gallery__item",p=m+", .wp-block-image",g={},h="undefined"!=typeof wpcom&&wpcom.carousel&&wpcom.carousel.stat?wpcom.carousel.stat:t.noop,f="undefined"!=typeof wpcom&&wpcom.carousel&&wpcom.carousel.pageview?wpcom.carousel.pageview:t.noop;function v(t){if(!u)switch(t.which){case 38:t.preventDefault(),g.overlay.scrollTop-=100;break;case 40:t.preventDefault(),g.overlay.scrollTop+=100;break;case 39:t.preventDefault(),e.slideNext();break;case 37:case 8:t.preventDefault(),e.slidePrev();break;case 27:t.preventDefault(),k()}}function y(){u=!0}function w(){u=!1}function S(e){e.role="button",e.tabIndex=0,e.ariaLabel=jetpackCarouselStrings.image_label}function j(){g.overlay||(g.overlay=document.querySelector(".jp-carousel-overlay"),g.container=g.overlay.querySelector(".jp-carousel-wrap"),g.gallery=g.container.querySelector(".jp-carousel"),g.info=g.overlay.querySelector(".jp-carousel-info"),g.caption=g.info.querySelector(".jp-carousel-caption"),g.commentField=g.overlay.querySelector("#jp-carousel-comment-form-comment-field"),g.emailField=g.overlay.querySelector("#jp-carousel-comment-form-email-field"),g.authorField=g.overlay.querySelector("#jp-carousel-comment-form-author-field"),g.urlField=g.overlay.querySelector("#jp-carousel-comment-form-url-field"),window.innerWidth<=760&&Math.round(window.innerWidth/760*110)<40&&r.isTouch(),[g.commentField,g.emailField,g.authorField,g.urlField].forEach(function(e){e&&(e.addEventListener("focus",y),e.addEventListener("blur",w))}),g.overlay.addEventListener("click",function(e){var t,o,a=e.target,n=!!r.closest(a,".jp-carousel-close-hint"),i=!!window.matchMedia("(max-device-width: 760px)").matches;a===g.overlay?i||k():n?k():a.classList.contains("jp-carousel-image-download")?h("download_original_click"):a.classList.contains("jp-carousel-comment-login")?(t=g.currentSlide,o=t?t.attrs.attachmentId:"0",window.location.href=jetpackCarouselStrings.login_url+"%23jp-carousel-"+o):r.closest(a,"#jp-carousel-comment-form-container")?function(e){var t=e.target,o=r.getJSONAttribute(g.container,"data-carousel-extra")||{},a=g.currentSlide.attrs.attachmentId,n=document.querySelector("#jp-carousel-comment-form-submit-and-info-wrapper"),i=document.querySelector("#jp-carousel-comment-form-spinner"),s=document.querySelector("#jp-carousel-comment-form-button-submit"),c=document.querySelector("#jp-carousel-comment-form");if(g.commentField&&g.commentField.getAttribute("id")===t.getAttribute("id"))y(),r.show(n);else if(r.matches(t,'input[type="submit"]')){e.preventDefault(),e.stopPropagation(),r.show(i),c.classList.add("jp-carousel-is-disabled");var u={action:"post_attachment_comment",nonce:jetpackCarouselStrings.nonce,blog_id:o.blog_id,id:a,comment:g.commentField.value};if(!u.comment.length)return void b(jetpackCarouselStrings.no_comment_text,!1);if(1!==Number(jetpackCarouselStrings.is_logged_in)&&(u.email=g.emailField.value,u.author=g.authorField.value,u.url=g.urlField.value,1===Number(jetpackCarouselStrings.require_name_email))){if(!u.email.length||!u.email.match("@"))return void b(jetpackCarouselStrings.no_comment_email,!1);if(!u.author.length)return void b(jetpackCarouselStrings.no_comment_author,!1)}var d=new XMLHttpRequest;d.open("POST",jetpackCarouselStrings.ajaxurl,!0),d.setRequestHeader("X-Requested-With","XMLHttpRequest"),d.setRequestHeader("Content-Type","application/x-www-form-urlencoded; charset=UTF-8"),d.onreadystatechange=function(){if(this.readyState===XMLHttpRequest.DONE&&this.status>=200&&this.status<300){var e;try{e=JSON.parse(this.response)}catch{return void b(jetpackCarouselStrings.comment_post_error,!1)}if("approved"===e.comment_status){b(jetpackCarouselStrings.comment_approved,!0);var t=function(e){for(var t=0;t<g.slides.length;t++)if(g.slides[t].attrs.attachmentId===e)return g.slides[t];return null}(a);t&&(t.attrs.commentsCount=(parseInt(t.attrs.commentsCount,10)||0)+1)}else"unapproved"===e.comment_status?b(jetpackCarouselStrings.comment_unapproved,!0):b(jetpackCarouselStrings.comment_post_error,!1);W(),delete l[a],_(a,void 0,!0),s.value=jetpackCarouselStrings.post_comment,r.hide(i),c.classList.remove("jp-carousel-is-disabled")}else b(jetpackCarouselStrings.comment_post_error,!1)};var m=[];for(var p in u)if(p){var h=encodeURIComponent(p)+"="+encodeURIComponent(u[p]);m.push(h.replace(/%20/g,"+"))}var f=m.join("&");d.send(f)}}(e):(r.closest(a,".jp-carousel-photo-icons-container")||a.classList.contains("jp-carousel-photo-title"))&&function(e){e.preventDefault();var t=e.target,o=g.info.querySelector(".jp-carousel-info-extra"),a=g.info.querySelector(".jp-carousel-image-meta"),n=g.info.querySelector(".jp-carousel-comments-wrapper"),i=g.info.querySelector(".jp-carousel-icon-info"),s=g.info.querySelector(".jp-carousel-icon-comments");function c(){s&&s.classList.remove("jp-carousel-selected"),i.classList.toggle("jp-carousel-selected"),n&&n.classList.remove("jp-carousel-show"),a&&(a.classList.toggle("jp-carousel-show"),a.classList.contains("jp-carousel-show")?o.classList.add("jp-carousel-show"):o.classList.remove("jp-carousel-show"))}function u(){if(i&&i.classList.remove("jp-carousel-selected"),s.classList.toggle("jp-carousel-selected"),a&&a.classList.remove("jp-carousel-show"),n)if(n.classList.toggle("jp-carousel-show"),n.classList.contains("jp-carousel-show")){o.classList.add("jp-carousel-show");var e=g.currentSlide;if(e){var t=l[e.attrs.attachmentId];t?t.hasMore&&T(e.attrs.attachmentId,t.nextOffset):_(e.attrs.attachmentId)}}else o.classList.remove("jp-carousel-show")}(r.closest(t,".jp-carousel-icon-info")||t.classList.contains("jp-carousel-photo-title"))&&(a&&a.classList.contains("jp-carousel-show")?r.scrollToElement(g.overlay,g.overlay,c):(c(),r.scrollToElement(g.info,g.overlay))),r.closest(t,".jp-carousel-icon-comments")&&(n&&n.classList.contains("jp-carousel-show")?r.scrollToElement(g.overlay,g.overlay,u):(u(),r.scrollToElement(g.info,g.overlay)))}(e)}),window.addEventListener("keydown",v),g.overlay.addEventListener("jp_carousel.afterOpen",function(){w(),g.slides.length<=1||(g.slides.length<=5?r.show(g.info.querySelector(".jp-swiper-pagination")):r.show(g.info.querySelector(".jp-carousel-pagination")))}),g.overlay.addEventListener("jp_carousel.beforeClose",function(){y(),document.documentElement.style.removeProperty("height"),e&&e.enable(),r.hide(g.info.querySelector(".jp-swiper-pagination")),r.hide(g.info.querySelector(".jp-carousel-pagination"))}),g.overlay.addEventListener("jp_carousel.afterClose",function(){window.history.pushState?history.pushState("",document.title,window.location.pathname+window.location.search):window.location.href="",c="",g.isOpen=!1}),g.overlay.addEventListener("touchstart",function(e){e.touches.length>1&&e.preventDefault()}))}function b(e,t){var o=g.overlay.querySelector("#jp-carousel-comment-post-results"),a="jp-carousel-comment-post-"+(t?"success":"error");o.innerHTML='<span class="'+a+'">'+e+"</span>",r.hide(g.overlay.querySelector("#jp-carousel-comment-form-spinner")),g.overlay.querySelector("#jp-carousel-comment-form").classList.remove("jp-carousel-is-disabled"),r.show(o)}function L(){var e=document.querySelectorAll("a img[data-attachment-id]");Array.prototype.forEach.call(e,function(e){var t=e.parentElement,o=t.parentElement;if(!o.classList.contains("gallery-icon")&&!r.closest(o,m)&&t.hasAttribute("href")){var a=!1;t.getAttribute("href").split("?")[0]===e.getAttribute("data-orig-file").split("?")[0]&&1===Number(jetpackCarouselStrings.single_image_gallery_media_file)&&(a=!0),t.getAttribute("href")===e.getAttribute("data-permalink")&&(a=!0),a&&(S(e),t.classList.add("single-image-gallery"),t.setAttribute("data-carousel-extra",JSON.stringify({blog_id:Number(jetpackCarouselStrings.blog_id)})))}})}function x(t,r){g.isOpen?(C(r),e.slideTo(r+1)):z(t,{startIndex:r})}function C(e){(!e||e<0||e>g.slides.length)&&(e=0),g.currentSlide=g.slides[e];var a,n,i=g.currentSlide,s=i.attrs.attachmentId;M(g.slides[e]),function(e){var t=[],r=g.slides.length;if(r>1){var o=e>0?e-1:r-1;t.push(o);var a=e<r-1?e+1:0;t.push(a)}t.forEach(function(e){var t=g.slides[e];t&&(M(t),1!==Number(jetpackCarouselStrings.display_background_image)||t.backgroundImage||F(t))})}(e),1!==Number(jetpackCarouselStrings.display_background_image)||g.slides[e].backgroundImage||F(g.slides[e]),r.hide(g.caption),function(e){var t,o,a,n,i,l,s;if(n=g.overlay.querySelector(".jp-carousel-photo-caption"),i=g.overlay.querySelector(".jp-carousel-caption"),l=g.overlay.querySelector(".jp-carousel-photo-title"),s=g.overlay.querySelector(".jp-carousel-photo-description"),r.hide(n),r.hide(i),r.hide(l),r.hide(s),t=A(e.caption)||"",o=A(e.title)||"",a=A(e.desc)||"",(t||o||a)&&(t&&(n.innerHTML=t,i.innerHTML=t,r.show(n),r.show(i)),r.stripHTML(t)===r.stripHTML(o)&&(o=""),r.stripHTML(t)===r.stripHTML(a)&&(a=""),r.stripHTML(o)===r.stripHTML(a)&&(a=""),a&&(s.innerHTML=a,r.show(s),o||t||(n.textContent=r.stripHTML(a),r.show(n))),o)){var c=r.stripHTML(o);l.textContent=c,t||(n.textContent=c,i.textContent=c,r.show(n)),r.show(l)}}({caption:i.attrs.caption,title:i.attrs.title,desc:i.attrs.desc}),function(e){if(!e||1!==Number(jetpackCarouselStrings.display_exif))return!1;var t=g.info.querySelector(".jp-carousel-image-meta");if(!t)return!1;var r="";for(var o in e){var a=e[o],n=jetpackCarouselStrings.meta_data||[];if(0!==parseFloat(a)&&a.length&&-1!==n.indexOf(o)){switch(o){case"focal_length":a+="mm";break;case"shutter_speed":a=E(a);break;case"aperture":a="f/"+a}r+="<li><h5>"+jetpackCarouselStrings[o]+"</h5>"+a+"</li>"}}var i=t.querySelector("ul.jp-carousel-image-exif");if(""!==r){if(!i){(i=document.createElement("ul")).className="jp-carousel-image-exif";var l=t.querySelector(".jp-carousel-title-and-caption");l&&l.nextSibling?t.insertBefore(i,l.nextSibling):t.insertBefore(i,t.firstChild)}i.innerHTML=r,i.style.removeProperty("display")}else i&&i.parentNode.removeChild(i)}(g.slides[e].attrs.imageMeta),function(e){if(!e)return!1;var r,o=[e.attrs.origWidth,e.attrs.origHeight],a=document.createElement("a");a.href=e.attrs.src.replace(/\?.+$/,""),r=null!==a.hostname.match(/^i[\d]{1}\.wp\.com$/i)?a.href:e.attrs.origFile.replace(/\?.+$/,"");var n=g.info.querySelector(".jp-carousel-download-text"),i=g.info.querySelector(".jp-carousel-image-download");n.innerHTML=t.applyReplacements(jetpackCarouselStrings.download_original,o),i.setAttribute("href",r),i.style.removeProperty("display")}(i),1===Number(jetpackCarouselStrings.display_comments)&&(a=g.slides[e].attrs.commentsOpened,n=g.info.querySelector("#jp-carousel-comment-form-container"),1===parseInt(a,10)?r.fadeIn(n):r.fadeOut(n),function(e){var t=e.attrs.attachmentId,a=g.info.querySelector(".jp-carousel-comments"),n=l[t];if(clearInterval(o),r.hide(g.info.querySelector("#jp-carousel-comments-loading")),n)return a.innerHTML=n.html,H(n.count),r.show(a),void(n.hasMore&&I()&&T(t,n.nextOffset));a.innerHTML="",r.hide(a),H(parseInt(e.attrs.commentsCount,10)||0),I()&&_(t)}(i),r.hide(g.info.querySelector("#jp-carousel-comment-post-results")));var u=g.info.querySelector(".jp-carousel-pagination");if(u&&g.slides.length>5){var d=e+1;u.innerHTML="<span>"+d+" / "+g.slides.length+"</span>"}jetpackCarouselStrings.stats&&g.isOpen&&((new Image).src=document.location.protocol+"//pixel.wp.com/g.gif?"+jetpackCarouselStrings.stats+"&post="+encodeURIComponent(s)+"&rand="+Math.random()),g.isOpen&&f(s),c="#jp-carousel-"+s,window.location.hash=c}function k(){document.body.style.overflow=a,document.documentElement.style.overflow=n,W(),y(),r.emitEvent(g.overlay,"jp_carousel.beforeClose"),window.scrollTo(window.scrollX||window.pageXOffset||0,i||0),g.isOpen=!1,e.destroy(),g.slides=[],l={},s={},g.currentSlide=void 0,g.gallery.innerHTML="",r.fadeOut(g.overlay,function(){r.emitEvent(g.overlay,"jp_carousel.afterClose")})}function q(e){if("object"!=typeof e&&(e={}),void 0===e.origFile)return"";if(void 0===e.origWidth||void 0===e.maxWidth)return e.origFile;if(!e.largeFile)return e.origFile;var t=document.createElement("a");t.href=e.largeFile;var r=/^i[0-2]\.wp\.com$/i.test(t.hostname),o=function(e,t,r){var o,a=r?e.replace(/.*=([\d]+%2C[\d]+).*$/,"$1"):e.replace(/.*-([\d]+x[\d]+)\..+$/,"$1");return"9999"===(o=a!==e?r?a.split("%2C"):a.split("x"):[t,0])[0]&&(o[0]="0"),"9999"===o[1]&&(o[1]="0"),o}(e.largeFile,e.origWidth,r),a=parseInt(o[0],10),n=parseInt(o[1],10);e.origMaxWidth=e.maxWidth,e.origMaxHeight=e.maxHeight,void 0!==window.devicePixelRatio&&window.devicePixelRatio>1&&(e.maxWidth=e.maxWidth*window.devicePixelRatio,e.maxHeight=e.maxHeight*window.devicePixelRatio);var i=e.zoomHeadroom||1;if(i>1&&(e.maxWidth=e.maxWidth*i,e.maxHeight=e.maxHeight*i),a>=e.maxWidth||n>=e.maxHeight)return e.largeFile;if(r){if(-1===e.largeFile.lastIndexOf("?"))return e.largeFile;var l=function(e){var t;try{t=new URL(e)}catch(t){return e}var r=["quality","ssl","filter","brightness","contrast","colorize","smooth"],o=Array.from(t.searchParams.entries());return t.search="",o.forEach(([e,o])=>{r.includes(e)&&t.searchParams.append(e,o)}),t}(e.largeFile);return(e.origWidth>e.maxWidth||e.origHeight>e.maxHeight)&&(e.origMaxWidth=e.maxWidth,e.origMaxHeight=e.maxHeight,l.searchParams.set("fit",e.origMaxWidth+","+e.origMaxHeight)),l.toString()}return e.origFile}function E(e){return e>=1?Math.round(10*e)/10+"s":"1/"+Math.round(1/e)+"s"}function A(e){return!e.match(" ")&&e.match("_")?"":e}function I(){var e=g.info.querySelector(".jp-carousel-comments-wrapper");return!!e&&e.classList.contains("jp-carousel-show")}function H(e){var t=g.info.querySelector(".jp-carousel-icon-comments .jp-carousel-has-comments-indicator");t&&(e>0?(t.innerText=e,t.classList.add("jp-carousel-show")):t.classList.remove("jp-carousel-show"))}function T(e,t){clearInterval(o),o=setInterval(function(){g.container.scrollTop+150>window.innerHeight&&(clearInterval(o),_(e,t))},300)}function _(e,t,a){var n=void 0===t;if(clearInterval(o),e&&g.currentSlide&&g.currentSlide.attrs.attachmentId===e&&(!s[e]||a)){(!t||t<1)&&(t=0);var i=g.info.querySelector(".jp-carousel-comments"),c=g.info.querySelector("#jp-carousel-comments-loading");r.show(c),n&&(r.hide(i),i.innerHTML="");var u=new XMLHttpRequest;s[e]=u;var d=function(){return s[e]===u},m=jetpackCarouselStrings.ajaxurl+"?action=get_attachment_comments&nonce="+jetpackCarouselStrings.nonce+"&id="+e+"&offset="+t;u.open("GET",m),u.setRequestHeader("X-Requested-With","XMLHttpRequest");var p=function(){r.fadeIn(i),r.fadeOut(c)};u.onload=function(){if(d()&&(delete s[e],g.currentSlide&&g.currentSlide.attrs.attachmentId===e)){var o,a=u.status>=200&&u.status<300;try{o=JSON.parse(u.responseText)}catch{}if(a&&o&&Array.isArray(o)){n&&(i.innerHTML="");for(var m=0;m<o.length;m++){var h=o[m];if(!i.querySelector("#jp-carousel-comment-"+h.id)){var f=document.createElement("div");f.classList.add("jp-carousel-comment"),f.setAttribute("id","jp-carousel-comment-"+h.id),f.innerHTML='<div class="comment-gravatar">'+h.gravatar_markup+'</div><div class="comment-content"><div class="comment-author">'+h.author_markup+'</div><div class="comment-date">'+h.date_gmt+"</div>"+h.content+"</div>",i.appendChild(f)}}var v=o.length>=10,y=t+10;v&&T(e,y);var w=i.querySelectorAll(".jp-carousel-comment").length,S=Math.max(parseInt(g.currentSlide.attrs.commentsCount,10)||0,w);o.length>0&&(r.show(i),H(S)),l[e]={html:i.innerHTML,count:S,hasMore:v,nextOffset:y},r.hide(c)}else p()}},u.onerror=function(){d()&&(delete s[e],g.currentSlide&&g.currentSlide.attrs.attachmentId===e&&p())},u.send()}}function M(e){var t=e.attrs,r=e.el.querySelector("img");if(!r.hasAttribute("data-loaded"))if(r.setAttribute("itemprop","image"),r.setAttribute("data-loaded",1),t.previewImage&&t.previewImage!==t.src){r.src=t.previewImage,r.style.filter="blur(8px)";var o=new window.Image;o.addEventListener("load",function(){r.hasAttribute("data-zoom-loaded")||(r.src=t.src),r.style.filter=""},{once:!0}),o.addEventListener("error",function(){r.style.filter=""},{once:!0}),o.src=t.src}else r.src=t.src}function F(e){var t=e.attrs.originalElement;if(t)if(t.complete&&0!==t.naturalHeight)O(e,t);else{var r=function(){t.removeEventListener("error",o),O(e,t)},o=function(){t.removeEventListener("load",r)};t.addEventListener("load",r,{once:!0}),t.addEventListener("error",o,{once:!0})}}function O(e,r){var o=t.getBackgroundImage(r);o&&(e.backgroundImage=o,e.el.style.backgroundImage="url("+o+")",e.el.style.backgroundSize="cover",e.el.style.backgroundPosition="center")}function W(){g.commentField&&(g.commentField.value="")}function N(e,o){g.slides=[];var a={width:window.innerWidth,height:window.innerHeight-64};0!==o&&null!==e[o].getAttribute("data-gallery-src")&&((new Image).src=e[o].getAttribute("data-gallery-src")),Array.prototype.forEach.call(e,function(e,o){var n=r.closest(e,"a"),i=e.getAttribute("data-orig-file")||e.getAttribute("src-orig"),l=e.getAttribute("data-attachment-id")||e.getAttribute("data-id")||"0",s=document.querySelector('img[data-attachment-id="'+l+'"] + figcaption');s=s?s.innerHTML:e.getAttribute("data-image-caption");var c={originalElement:e,attachmentId:l,commentsOpened:e.getAttribute("data-comments-opened")||"0",commentsCount:e.getAttribute("data-comments-count")||"0",imageMeta:r.getJSONAttribute(e,"data-image-meta")||{},title:e.getAttribute("data-image-title")||"",desc:e.getAttribute("data-image-description")||"",largeFile:e.getAttribute("data-large-file")||"",origFile:i||"",thumbSize:{width:e.naturalWidth,height:e.naturalHeight},caption:s||"",permalink:n&&n.getAttribute("href"),src:i||e.getAttribute("src")||""},u=r.closest(e,".tiled-gallery-item"),d=u&&u.querySelector(".tiled-gallery-caption"),m=d&&d.innerHTML;m&&(c.caption=m);var p=function(e){var t=e.getAttribute("data-orig-size")||"";if(t){var r=t.split(",");return{width:parseInt(r[0],10),height:parseInt(r[1],10)}}return{width:e.getAttribute("data-original-width")||e.getAttribute("width")||void 0,height:e.getAttribute("data-original-height")||e.getAttribute("height")||void 0}}(e);if(c.origWidth=p.width||c.thumbSize.width,c.origHeight=p.height||c.thumbSize.height,"undefined"!=typeof wpcom&&wpcom.carousel&&wpcom.carousel.generateImgSrc)c.src=wpcom.carousel.generateImgSrc(e,a);else{var h=function(e){return{origFile:c.src,origWidth:c.origWidth,origHeight:c.origHeight,maxWidth:a.width,maxHeight:a.height,largeFile:c.largeFile,zoomHeadroom:e}};c.zoomSrc=q(h(2)),c.src=q(h(1))}if(e.setAttribute("data-gallery-src",c.src),"0"!==c.attachmentId){c.title=t.texturize(c.title),c.desc=t.texturize(c.desc),c.caption=t.texturize(c.caption);var f=new Image,v=document.createElement("div");v.classList.add("swiper-slide"),v.setAttribute("itemprop","associatedMedia"),v.setAttribute("itemscope",""),v.setAttribute("itemtype","https://schema.org/ImageObject");var y=document.createElement("div");y.classList.add("swiper-zoom-container"),g.gallery.appendChild(v),v.appendChild(y),y.appendChild(f),v.setAttribute("data-attachment-id",c.attachmentId),v.setAttribute("data-permalink",c.permalink),v.setAttribute("data-orig-file",c.origFile),c.previewImage=e.currentSrc||e.getAttribute("src")||"";var w={el:v,attrs:c,index:o};g.slides.push(w)}})}function z(e,t){if(!window.JetpackSwiper){var o=document.querySelector("#jp-carousel-loading-overlay");r.show(o);var a=document.createElement("script");return a.id="jetpack-carousel-swiper-js",a.src=window.jetpackSwiperLibraryPath.url,a.async=!0,a.onload=function(){r.hide(o),R(e,t)},a.onerror=function(){r.hide(o)},void document.head.appendChild(a)}R(e,t)}function R(t,o){var c,u={imgSelector:".gallery-item [data-attachment-id], .tiled-gallery-item [data-attachment-id], img[data-attachment-id], img[data-id]",startIndex:0},d=r.getJSONAttribute(t,"data-carousel-extra");if(!d)return;const m=t.querySelectorAll(u.imgSelector);if(m.length&&(j(),!g.isOpen)){for(var p in g.isOpen=!0,a=getComputedStyle(document.body).overflow,document.body.style.overflow="hidden",n=getComputedStyle(document.documentElement).overflow,document.documentElement.style.overflow="hidden",i=window.scrollY||window.pageYOffset||0,g.container.setAttribute("data-carousel-extra",JSON.stringify(d)),h(["open","view_image"]),o||{})u[p]=o[p];-1===u.startIndex&&(u.startIndex=0),r.emitEvent(g.overlay,"jp_carousel.beforeOpen"),g.gallery.innerHTML="",l={},s={},g.overlay.style.opacity=1,g.overlay.style.display="block",N(m,u.startIndex),(e=new window.JetpackSwiper(".jp-carousel-swiper-container",{centeredSlides:!0,speed:r.prefersReducedMotion()?0:250,zoom:!0,loop:g.slides.length>1,enabled:g.slides.length>1,pagination:{el:".jp-swiper-pagination",clickable:!0},navigation:{nextEl:".jp-swiper-button-next",prevEl:".jp-swiper-button-prev"},initialSlide:u.startIndex,on:{init:function(){C(u.startIndex)}},preventClicks:!1,preventClicksPropagation:!1,preventInteractionOnTransition:!r.isTouch(),threshold:5})).on("slideChange",function(e){g.isOpen&&(C(e.realIndex),g.overlay.classList.remove("jp-carousel-hide-controls"))}),e.on("zoomChange",function(e,t){t>1&&(function(e){if(e&&e.attrs.zoomSrc&&e.attrs.zoomSrc!==e.attrs.src){var t=e.el.querySelector("img");t&&!t.hasAttribute("data-zoom-loaded")&&(t.setAttribute("data-zoom-loaded",1),t.src=e.attrs.zoomSrc)}}(g.currentSlide),g.overlay.classList.add("jp-carousel-hide-controls")),1===t&&g.overlay.classList.remove("jp-carousel-hide-controls")}),e.on("doubleTap",function(e){if(clearTimeout(c),1===e.zoom.scale)var t=setTimeout(function(){g.overlay.classList.remove("jp-carousel-hide-controls"),clearTimeout(t)},150)}),e.on("tap",function(){e.zoom.scale>1&&(c=setTimeout(function(){g.overlay.classList.toggle("jp-carousel-hide-controls")},150))}),r.fadeIn(g.overlay,function(){r.emitEvent(g.overlay,"jp_carousel.afterOpen")})}}function P(e){if("click"!==e.type){if("keydown"===e.type){const t=document.activeElement.parentElement,r=t&&t.classList.contains("tiled-gallery__item");" "!==e.key&&"Enter"!==e.key||!r||$(e)}}else $(e)}function D(e){return(e||"").split("?")[0].replace(/\/$/,"")}function J(e){"A"===e.tagName&&(e=e.querySelector("img")||e);var t=e.parentElement,o=t?t.parentElement:null,a=null;if(o&&o.classList.contains("wp-block-image")?a=t.getAttribute("href"):t&&t.classList.contains("wp-block-image")&&t.querySelector(":scope > a")&&(a=t.querySelector(":scope > a").getAttribute("href")),a){var n=D(a),i=D(e.getAttribute("data-orig-file")),l=D(e.getAttribute("data-permalink"));if(n!==i&&n!==l)return!1}return!(t&&t.classList.contains("gallery-caption")||r.matches(t,"figcaption"))}function $(e){if(window.CSS&&window.CSS.supports&&window.CSS.supports("display","grid")){var t,o=e.target,a=r.closest(o,d);if(a){if(!(t=a)||!t.getAttribute("data-carousel-extra"))return;if(!J(o))return;document.documentElement.style.height="auto",e.preventDefault(),e.stopPropagation();var n=r.closest(o,p),i=Array.prototype.indexOf.call(a.querySelectorAll(p),n);z(a,{startIndex:i})}}}document.body.addEventListener("click",P),document.body.addEventListener("keydown",P),document.querySelectorAll(m+"img").forEach(function(e){J(e)&&S(e)}),1===Number(jetpackCarouselStrings.single_image_gallery)&&(L(),document.body.addEventListener("is.post-load",function(){L()})),window.addEventListener("hashchange",function(){var e=/jp-carousel-(\d+)/;if(window.location.hash&&e.test(window.location.hash)){if(window.location.hash!==c||!g.isOpen)if(window.location.hash&&g.gallery&&!g.isOpen&&history.back)history.back();else{c=window.location.hash;for(var t=window.location.hash.match(e),r=parseInt(t[1],10),o=document.querySelectorAll(d),a=0;a<o.length;a++){for(var n,i=o[a],l=i.querySelectorAll("img"),s=0;s<l.length;s++)if(parseInt(l[s].getAttribute("data-attachment-id"),10)===r||parseInt(l[s].getAttribute("data-id"),10)===r){n=s;break}if(void 0!==n){x(i,n);break}}}}else g.isOpen&&k()}),window.location.hash&&r.emitEvent(window,"hashchange")}"loading"!==document.readyState?o():document.addEventListener("DOMContentLoaded",o)}();;
