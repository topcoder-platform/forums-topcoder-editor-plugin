(function($) {
  $.fn.setAsEditor = function(selector) {
    selector = selector || '.BodyBox,.js-bodybox';

    // If editor can be loaded, add class to body
    $('body').addClass('topcodereditor-active');

    /**
     * Determine editor format to load, and asset path, default to Wysiwyg
     */
    var editor,
      editorCacheBreakValue = Math.random(),
      editorVersion = gdn.definition('editorVersion', editorCacheBreakValue),
      defaultInputFormat = gdn.definition('defaultInputFormat', 'Markdown'),
      defaultMobileInputFormat = gdn.definition('defaultMobileInputFormat', 'Markdown'),
      editorInputFormat = gdn.definition('editorInputFormat', 'Markdown'),
      topcoderEditorToolbar = gdn.definition('topcoderEditorToolbar');

    var canUpload = (gdn.definition('canUpload', false)) ? 1 : 0;
    var maxUploadSize = gdn.definition('maxUploadSize');
    var allowedImageExtensions = gdn.definition('allowedImageExtensions');
    var allowedFileExtensions = gdn.definition('allowedFileExtensions');
    var allowedFileMimeTypes = gdn.definition('allowedFileMimeTypes');
    var maxFileUploads = gdn.definition('maxFileUploads');
    var debug = false;

    logMessage('topcoderEditorData:' + JSON.stringify(topcoderEditorToolbar));
    logMessage('maxUploadSize:' + maxUploadSize);
    logMessage('allowedImageExtensions:' + allowedImageExtensions);
    logMessage('allowedFileExtensions:' + allowedFileExtensions);
    logMessage('allowedFileMimeTypes:' + allowedFileMimeTypes);
    logMessage('maxFileUploads:' + maxFileUploads);

    function logMessage(message) {
      if (debug) {
        console.log('TopcoderEditorPlugin::'+ message);
      }
    }

    /**
     * Convert the first char to Uppercase
     * @param str
     * @returns {*|string}
     */
    function ucfirst(str) {
        return str && str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Load a list of Topcoder handles
     * @param cm
     * @param option
     * @returns {Promise<unknown>}
     */
    function topcoderHandles(cm, option) {
      return new Promise(function(accept) {
        setTimeout(function() {
          var cursor = cm.getCursor(), line = cm.getLine(cursor.line);
          var start = cursor.ch, end = cursor.ch
          while (start && /\w/.test(line.charAt(start - 1))) --start
          while (end < line.length && /\w/.test(line.charAt(end))) ++end
          var word = line.slice(start, end).toLowerCase();
          //logMessage('word' + word + ', length:' + word.length);
          if(word.length > 1) {
            $.ajax({
              type: "GET",
              url: "/api/v2/topcoder?handle=" + word,
              cache: false,
              success: function (data) {
                var result = [];
                $.each(data, function (i, item) {
                  result.push({text: data[i].handle, displayText: data[i].handle+ "("+ data[i].firstName + ' ' + data[i].lastName +")",
                    className: 'Username'});
                });
                return accept({
                  list: result,
                  from: CodeMirror.Pos(cursor.line, start),
                  to: CodeMirror.Pos(cursor.line, end)
                })
              },
              error: function (msg) {
                return accept({
                  list: [],
                  from: CodeMirror.Pos(cursor.line, start),
                  to: CodeMirror.Pos(cursor.line, end)
                })
              }
            });
          } else {
            accept({
              list: [],
              from: CodeMirror.Pos(cursor.line, start),
              to: CodeMirror.Pos(cursor.line, end)
            })
          }
        }, 500)

      })
    }

    /**
     *  Show hint after '@'
     * @param cm
     * @param pred
     * @returns {{toString: (function(): string)}}
     */
    function completeAfter(cm, pred) {
       if (!pred || pred()) {
        setTimeout(function () {
          if (!cm.state.completionActive) {
            var currentLine = cm.getCursor().line;
            if (cm.getCursor().ch === 0) {
              cm.replaceSelection("@");
              cm.showHint({ completeSingle: false, alignWithWord: true });
            } else {
              var from = { line: cm.getCursor().line, ch: 0};
              var to = cm.getCursor()
              var line = cm.getRange(from , to);
              var lastIndexOf = line.lastIndexOf(' ');
              var tokenIndex = lastIndexOf > -1 ?  lastIndexOf+1 : 0;
              cm.replaceRange("@", {line: cm.getCursor().line, ch: tokenIndex});
              cm.showHint({ completeSingle: false, alignWithWord: true });
            }
          }
        }, 500);
      }
      return CodeMirror.Pass;
    }

    function customUploadImage(file, onSuccess, onError) {
      var self = this;
      var position = {};

      onSuccess = function onSuccess(jsonData) {
        updateMediaIDs(self, jsonData);
        afterFileUploaded(self, jsonData, position);
      };

      onError = function onError(errorMessage) {
        showErrorMessage(self,errorMessage)
        if(position) {
          self.codemirror.replaceRange("", position.start, position.end);
        }
      }

      function onErrorSup(errorMessage) {
        // show reset status bar
        self.updateStatusBar('upload-image', self.options.imageTexts.sbInit);
        // run custom error handler
        if (onError && typeof onError === 'function') {
          //onError(errorMessage);
          onError(errorMessage);
        }
        // run error handler from options
        self.options.errorCallback(errorMessage);
      }

      // Parse a server response
      function parseServerErrors(response){
        var errorMessages = '<div class="Messages Errors"><ul>'
        if(response.errors) {
          for (var error of response.errors) {
            errorMessages += '<li>' + ucfirst(error.message) + '</li>'
          }
        } else {
          errorMessages += '<li>'+ ucfirst(response.message) + '</li>';
        }
        errorMessages +='</ul></div>';
        return errorMessages;
      }

      // Parse a message
      function fillErrorMessage(errorMessage) {
        var units = self.options.imageTexts.sizeUnits.split(',');

        var error =  errorMessage
          .replace('#image_type#', file.type)
          .replace('#image_name#', file.name)
          .replace('#image_size#', humanFileSize(file.size, units))
          .replace('#image_max_size#', humanFileSize(self.options.imageMaxSize, units));

        return '<div class="Messages Errors"><ul><li>'+error + '</li></ul></div>';
      }

      // Save a position of image/file tag
      function onPosition(start, end) {
        position.start = start;
        position.end = end;
      }

      // Check max file size before uploading
      if (file.size > this.options.imageMaxSize) {
         onErrorSup(fillErrorMessage(this.options.errorMessages.fileTooLarge));
         return;
      }

      // Check mime types
      if(!this.options.imageAccept.includes(file.type)){
        onErrorSup(fillErrorMessage(this.options.errorMessages.typeNotAllowed));
        return;
      }

      beforeUploadingFile(self, file, onPosition);

      var formData = new FormData();
      formData.append('file', file);

      var request = new XMLHttpRequest();
      request.upload.onprogress = function (event) {
        if (event.lengthComputable) {
          var progress = '' + Math.round((event.loaded * 100) / event.total);
          self.updateStatusBar('upload-image', self.options.imageTexts.sbProgress.replace('#file_name#', file.name).replace('#progress#', progress));
        }
      };

      request.open('POST', '/api/v2/media');
      request.setRequestHeader('X-Requested-With', 'vanilla');

      request.onload = function () {
        try {
          var response = JSON.parse(this.responseText);
        } catch (error) {
          console.error('EasyMDE: The server did not return a valid json.');
          onErrorSup(fillErrorMessage(self.options.errorMessages.importError));
          return;
        }
        if (this.status === 201 && response && !response.error && response.mediaID > 0 && response.size > 0) {
          onSuccess(response);
        } else {
          if (response.errors) {  // server side generated error message
            onErrorSup(parseServerErrors(response));
          } else {  //unknown error
            console.error('EasyMDE: Received an unexpected response after uploading the image.'
              + this.status + ' (' + this.statusText + ')');
            onErrorSup(fillErrorMessage(self.options.errorMessages.importError));
          }
        }
      };

      request.onerror = function (event) {
        console.error('EasyMDE: An unexpected error occurred when trying to upload the file.'
          + event.target.status + ' (' + event.target.statusText + ')');
        onErrorSup(self.options.errorMessages.importError);
      };

      request.send(formData);
    }

    function errorCallback(message) {
     // gdn.informMessage (message);
    }

    /**
     * The state of CodeMirror at the given position.
     */
    function getState(cm, pos) {
      pos = pos || cm.getCursor('start');
      var stat = cm.getTokenAt(pos);
      if (!stat.type) return {};

      var types = stat.type.split(' ');

      var ret = {},
        data, text;
      for (var i = 0; i < types.length; i++) {
        data = types[i];
        if (data === 'strong') {
          ret.bold = true;
        } else if (data === 'variable-2') {
          text = cm.getLine(pos.line);
          if (/^\s*\d+\.\s/.test(text)) {
            ret['ordered-list'] = true;
          } else {
            ret['unordered-list'] = true;
          }
        } else if (data === 'atom') {
          ret.quote = true;
        } else if (data === 'em') {
          ret.italic = true;
        } else if (data === 'quote') {
          ret.quote = true;
        } else if (data === 'strikethrough') {
          ret.strikethrough = true;
        } else if (data === 'comment') {
          ret.code = true;
        } else if (data === 'link') {
          ret.link = true;
        } else if (data === 'tag') {
          ret.image = true;
        } else if (data.match(/^header(-[1-6])?$/)) {
          ret[data.replace('header', 'heading')] = true;
        }
      }
      return ret;
    }

    /**
     * Calculate file size in units
     * @param bytes
     * @param units
     * @returns {string}
     */
    function humanFileSize(bytes, units) {
      if (Math.abs(bytes) < 1024) {
        return '' + bytes + units[0];
      }
      var u = 0;
      do {
        bytes /= 1024;
        ++u;
      } while (Math.abs(bytes) >= 1024 && u < units.length);
      return '' + bytes.toFixed(1) + units[u];
    }

    /**
     *
     * @param editor
     * @param file
     * @param onPosition
     */
    function beforeUploadingFile(editor,file, onPosition) {
      var cm = editor.codemirror;
      var stat = getState(cm);
      var options = editor.options;
      var fileName = file.name;
      var ext = fileName.substring(fileName.lastIndexOf('.') + 1);
      // Check if file type is an image
      if (allowedImageExtensions.includes(ext)) {
        _replaceSelection(cm, stat.image, options.insertTexts.uploadingImage, {name: fileName}, onPosition);
      } else {
        _replaceSelection(cm, stat.link, options.insertTexts.uploadingFile,  {name: fileName}, onPosition);
      }
    }

    function afterFileUploaded(editor,jsonData, position) {
      var cm = editor.codemirror;
      var options = editor.options;
      var imageName = jsonData.name;
      var ext = imageName.substring(imageName.lastIndexOf('.') + 1);

      // Check if file type is an image
      if (allowedImageExtensions.includes(ext)) {
        _updateFileTag(cm, position,options.insertTexts.uploadedImage, jsonData);
      } else {
        _updateFileTag(cm, position, options.insertTexts.uploadedFile, jsonData);
      }

      // show uploaded image filename for 1000ms
      editor.updateStatusBar('upload-image', editor.options.imageTexts.sbOnUploaded.replace('#image_name#', imageName));
      setTimeout(function () {
        editor.updateStatusBar('upload-image', editor.options.imageTexts.sbInit);
      }, 1000);
    }

    function _updateFileTag(cm, position, startEnd, data) {
      if (/editor-preview-active/.test(cm.getWrapperElement().lastChild.className))
        return;

      var start = startEnd[0];
      var end = startEnd[1];
      var startPoint = {},
        endPoint = {};
      if(data && (data.url || data.name)) {
        start = start.replace('#name#', data.name);  // url is in start for upload-image
        start = start.replace('#url#', data.url);  // url is in start for upload-image
        end = end.replace('#name#', data.name);
        end = end.replace('#url#', data.url);
      }
      Object.assign(startPoint,{
        line: position.start.line,
        ch: position.start.ch,
      });
      Object.assign(endPoint, {line: position.end.line,
        ch: position.end.ch});
      cm.replaceRange(start + end, startPoint, endPoint);

      var selectionPosition = {
        line: position.start.line,
        ch: start.length + end.length
      }
      cm.setSelection(selectionPosition, selectionPosition);
      cm.focus();
    }

    function _replaceSelection(cm, active, startEnd, data, onPosition) {
      if (/editor-preview-active/.test(cm.getWrapperElement().lastChild.className))
        return;

      var text;
      var start = startEnd[0];
      var end = startEnd[1];
      var startPoint = {},
        endPoint = {};
      var currentPosition = cm.getCursor();

      // Start uploading from a new line
      if(currentPosition.ch != 0) {
          cm.replaceSelection("\n");
      }

      Object.assign(startPoint, cm.getCursor('start'));
      Object.assign(endPoint, cm.getCursor('end'));
      if(data && data.name) {
        start = start.replace('#name#', data.name);
        end = end.replace('#name#', data.name);
      }

      var initStartPosition = {
        line: startPoint.line,
        ch: startPoint.ch
      }

      if (active) {
        text = cm.getLine(startPoint.line);
        start = text.slice(0, startPoint.ch);
        end = text.slice(startPoint.ch);
        cm.replaceRange(start + end, {
          line: startPoint.line,
          ch: 0,
        });
      } else {
        text = cm.getSelection();
        cm.replaceSelection(start + text + end);
        startPoint.ch += start.length;
        if (startPoint !== endPoint) {
          endPoint.ch += start.length;
        }
      }
      onPosition(initStartPosition, endPoint);

      var line = cm.getLine(cm.getCursor().line);
      var appendedTextLength = start.length + text.length + end.length;
      if(line.length > appendedTextLength) {
        cm.replaceSelection("\n");
        cm.setSelection({line: startPoint.line+1, ch: line.length - appendedTextLength},
          {line: startPoint.line+1, ch: line.length - appendedTextLength     });
      } else {
        // Set a cursor at the end of line
        cm.setSelection(startPoint, endPoint);
      }
      logMessage('position: file' + data.name +':' + JSON.stringify(startPoint) + ' , '+ JSON.stringify(endPoint));
      logMessage('line: getCursor:' + cm.getCursor().line);

      cm.focus();
      logMessage('after focus: getCursor:' + cm.getCursor().line);
    }

    function updateMediaIDs(editor, jsonData) {
      var $element = editor.element;
      var postForm = $($element.closest('form'));
      $(postForm).append('<input type="hidden" id="Form_MediaIDs" name="MediaIDs[]" value="'+jsonData.mediaID+'"/>');
      var mediaIDs = $(postForm).find('input[name="MediaIDs[]"]');
      logMessage('MediaIDs='+mediaIDs);
    }

    function showErrorMessage(editor, errorMessage) {
      var $element = editor.element;
      var postForm = $($element.closest('form'));
      // Remove any old errors from the form
      $(postForm).find('div.Errors').remove();
      $(postForm).prepend(errorMessage);
    }

    /**
     * Initialize editor on the page.
     *
     */
    var editorInit = function (textareaObj) {
        var $currentEditableTextarea = $(textareaObj);
        var $postForm = $(textareaObj).closest('form');
        var currentFormFormat = $postForm.find('input[name="Format"]');
        var currentTextBoxWrapper; // div wrapper

        if (currentFormFormat.length) {
          currentFormFormat = currentFormFormat[0].value.toLowerCase();
        }

        logMessage('The default format is '+ editorInputFormat);
        logMessage('The form format is '+ JSON.stringify(currentFormFormat));

        currentTextBoxWrapper = $currentEditableTextarea.parent('.TextBoxWrapper');
        // If singleInstance is false, then odds are the editor is being
        // loaded inline and there are other instances on page.
        var singleInstance = true;

        // Determine if editing a comment, or not. When editing a comment,
        // it has a comment id, while adding a new comment has an empty
        // comment id. The value is a hidden input.
        var commentId = $postForm.find('#Form_CommentID').val();
        var discussionId = $postForm.find('#Form_DiscussionID').val();
        var formConversationId = $postForm.find('#Form_ConversationID').val();
        var draftId = $postForm.find('#Form_DraftID').val();

        logMessage('DiscussionID=' + discussionId);
        logMessage('CommentID=' + commentId);
        logMessage('DraftID=' + draftId);

        if (typeof commentId != 'undefined' && commentId != '') {
          singleInstance = false;
        }

        logMessage('isSingleInstance='+singleInstance);

        if ($currentEditableTextarea.length) {
          // instantiate new editor
          var editor = new EasyMDE({
            shortcuts: {
              "mentions": "Ctrl-Space",
            },
            autofocus: false,
            forceSync: true, // true, force text changes made in EasyMDE to be immediately stored in original text area.
            placeholder: '',
            element: $currentEditableTextarea[0],
            hintOptions: { hint: topcoderHandles },
            toolbar: ["bold", "italic", "strikethrough", "|",
              "heading-1", "heading-2", "heading-3", "|", "code", "quote", "|", "unordered-list",
              "ordered-list", "clean-block", "|", {
                name: "mentions",
                action: function mentions (editor) {
                  completeAfter(editor.codemirror);
                },
                className: "fa fa-at",
                title: "Mention a Topcoder User",

              }, "link", canUpload ? 'upload-image' : "image", "table", "horizontal-rule", "|", "fullscreen", "|", "guide"],
            hideIcons: ["guide", "heading", "preview", "side-by-side"],
            insertTexts: {
              link: ['[', '](#url#)'],
              image: ['![](', '#url#)'],
              file: ['[](', '#url#)'],
              uploadingImage:["![Uploading #name#]()",""],
              uploadingFile:["[Uploading #name#]()",""],
              uploadedImage: ["![#name#](#url#)", ""],
              uploadedFile: ['[#name#](#url#)', ""],
              horizontalRule: ["", "\n\n-----\n\n"],
              table: ["", "\n\n| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Text     | Text      | Text     |\n\n"],
            },
            imageTexts:{
              sbInit: 'Attach files by dragging & dropping, selecting or pasting them.',
              sbOnDragEnter: 'Drop file to upload it.',
              sbOnDrop: 'Uploading file #images_names#...',
              sbProgress: 'Uploading #file_name#: #progress#%',
              sbOnUploaded: 'Uploaded #image_name#',
              sizeUnits: ' B, KB, MB',
             },
             uploadImage: true,
             imageMaxSize: maxUploadSize, //Maximum image size in bytes
             imageAccept: allowedFileMimeTypes, //A comma-separated list of mime-types
             imageUploadFunction: customUploadImage,
             errorCallback:  errorCallback,// A callback function used to define how to display an error message.
             errorMessages: {
               noFileGiven: 'Select a file.',
               typeNotAllowed: 'The file type (#image_type#) is not supported.',
               fileTooLarge: 'File #image_name# is too big (#image_size#).\n' +
                 'Maximum file size is #image_max_size#.',
               importError: 'Something went wrong when uploading the file #image_name#.',
             }
          });

          // forceSync = true, need to clear form after async requests
          $currentEditableTextarea.closest('form').on('complete', function (frm, btn) {
            logMessage("form::complete");
            editor.codemirror.setValue('');
          });

          editor.codemirror.on('keydown', function (cm, event) {
            if (!cm.state.completionActive /*Enables keyboard navigation in autocomplete list*/) {
              if (event.key == '@') {
                var currentCursorPosition = cm.getCursor();
                if (currentCursorPosition.ch === 0) {
                  cm.showHint({ completeSingle: false, alignWithWord: true });
                  return;
                }

                var backwardCursorPosition = {
                  line: currentCursorPosition.line,
                  ch: currentCursorPosition.ch - 1
                };
                var backwardCharacter = cm.getRange(backwardCursorPosition, currentCursorPosition);
                if (backwardCharacter === ' ') { // space
                  cm.showHint({ completeSingle: false, alignWithWord: true });
                }
              }
            }
          });
        }
    }; //editorInit

    editorInit(this);
    // jQuery chaining
    return this;
  };

  $(document).on('contentLoad', function(e) {
    if ($('.BodyBox[format="Markdown"], .BodyBox[format="wysiwyg"],.js-bodybox[format="Markdown"], .js-bodybox[format="wysiwyg"]', e.target).length === 0) {
      console.log('Supported only [format="Markdown"][format="wysiwyg"]');
      return;
    }
    // Multiple editors are supported on a page
    $('.BodyBox[format="Markdown"], .BodyBox[format="wysiwyg"],.js-bodybox[format="Markdown"], .js-bodybox[format="wysiwyg"]', e.target).setAsEditor();
  });
}(jQuery));
