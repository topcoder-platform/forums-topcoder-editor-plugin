(function($) {
  var editor;
  var allEditors = [];
  $.fn.setAsEditor = function(selector) {
    selector = selector || '.BodyBox,.js-bodybox';

    // If editor can be loaded, add class to body
    $('body').addClass('topcodereditor-active');

    /**
     * Determine editor settings
     */
    var maxCommentLength = (gdn.definition('maxCommentLength'));
    var canUpload = (gdn.definition('canUpload', false)) ? 1 : 0;
    var maxUploadSize = gdn.definition('maxUploadSize');
    var allowedImageExtensions = gdn.definition('allowedImageExtensions');
    var allowedFileMimeTypeWithExts = gdn.definition('allowedFileMimeTypeWithExts');

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
          while (start && /[\w\.\+-]/.test(line.charAt(start - 1))) --start
          while (end < line.length && /[\w\.\+-]/.test(line.charAt(end))) ++end
          var word = line.slice(start, end).toLowerCase();
          if(word.length > 1) {
            $.ajax({
              type: "GET",
              url: "/api/v2/topcoder?handle=" + word,
              cache: false,
              success: function (data) {
                var result = [];
                $.each(data, function (i, item) {
                  var text = data[i].handle;
                  if(/[\W]/.test(text) > -1) {
                    text = '"' + text + '"';
                  }
                  result.push({text: text, displayText: data[i].handle, className: 'Username'});
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

    function resetFileInput(editor){
      var imageInput = editor.gui.toolbar.getElementsByClassName('imageInput')[0];
      imageInput.value ='';
    }

    function customUploadImage(file, onSuccess, onError) {
      var self = this;
      var position = {};

      onSuccess = function onSuccess(jsonData) {
        afterFileUploaded(self, jsonData, position);
        resetFileInput(self);
      };

      onError = function onError(errorMessage) {
        showErrorMessage(self,errorMessage);
        if(position && position.start && position.end) {
          self.codemirror.replaceRange("", position.start, position.end);
        }
        resetFileInput(self);
      }

      function onErrorSup(errorMessage) {
        // show reset status bar
        self.updateStatusBar('upload-image', self.options.imageTexts.sbInit);
        // run custom error handler
        if (onError && typeof onError === 'function') {
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
            errorMessages += '<li>Couldn\'t upload '+ file.name +'. '+ ucfirst(error.message) + '</li>'
          }
        } else {
          errorMessages += '<li>Couldn\'t upload '+ file.name+ '. '+ ucfirst(response.message) + '</li>';
        }
        errorMessages +='</ul></div>';
        return errorMessages;
      }

      // Parse a message
      function fillErrorMessage(errorMessage) {
        var units = self.options.imageTexts.sizeUnits.split(',');


        var error =  errorMessage
          .replace('#image_type#', getFileType())
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

      function getFileType() {
         // Sometimes a browser couldn't define mime/types, use file extension
         return file.type? file.type: file.name.substring(file.name.lastIndexOf('.') + 1);
      }

      // Check mime types
      if (!this.options.imageAccept.includes(getFileType())) {
         onErrorSup(fillErrorMessage(this.options.errorMessages.typeNotAllowed));
          return;
      }

      // Check max file size before uploading
      if (file.size > this.options.imageMaxSize) {
         onErrorSup(fillErrorMessage(this.options.errorMessages.fileTooLarge));
         return;
      }

      beforeUploadingFile(self, file, onPosition);

      var formData = new FormData();
      formData.append('file', file);

      var $element = self.element;
      var postForm = $element.closest('form');
      var commentId = $(postForm).find('#Form_CommentID').val();
      var discussionId = $(postForm).find('#Form_DiscussionID').val();
      var categoryId = $(postForm).find('#Form_CategoryID').val();
      var actionType = $(postForm).find('#Form_ActionType').val();
      if(actionType != null) {
        formData.append('actionType', actionType);
      }
      if(categoryId != null) {
        formData.append('categoryID', categoryId);
      }
      if(commentId != null) {
        formData.append('commentID', commentId);
      }
      if(discussionId != null) {
        formData.append('discussionID', discussionId);
      }

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
          if (response.errors || response.message) {  // server side generated error message
            onErrorSup(parseServerErrors(response));
          } else {
              //unknown error
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
      cm.focus();
    }

    function beforeUploadingImages(files) {
      var self = this;
      var $element = self.element;
      var postForm = $element.closest('form');
      // Remove any old errors from the form
      $(postForm).find('div.Errors').remove();
    }

    function showErrorMessage(editor, errorMessage) {
      var $element = editor.element;
      var postForm = $element.closest('form');
      $(postForm).prepend(errorMessage);
    }

    function columnWidth(rows, columnIndex) {
      return Math.max.apply(null, rows.map(function(row) {
        return ('' + row[columnIndex]).length
      }))
    }

    function looksLikeTable(rows){
      if(rows && rows.length < 2) {
        return false;
      }
      var countOfColumns = rows[0].length;
      if (countOfColumns < 2) {
         return false;
      }
      // Each row has the same count of columns
      for(var i = 1; i < rows.length; i++){
          if(countOfColumns != rows[i].length) {
             return false;
          }
      }
      return true;
    }

    /**
     * Initialize editor on the page.
     *
     */
    var editorInit = function (textareaObj) {
        var $currentEditableTextarea = $(textareaObj);
        if ($currentEditableTextarea.length) {
          // instantiate new editor
          editor = new EasyMDE({
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

              }, "link","upload-image" , "image", "table", "horizontal-rule", "|", "fullscreen", "|", "guide"],
            hideIcons:  canUpload ? ["guide", "heading", "preview", "side-by-side"]: ["guide", "heading", "preview", "side-by-side", "upload-image"],
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
            uploadImage: canUpload,
            imageMaxSize: maxUploadSize, //Maximum image size in bytes
            imageAccept: allowedFileMimeTypeWithExts, //A comma-separated list of mime-types and extensions
            imageUploadFunction: customUploadImage,
            beforeUploadingImagesFunction: beforeUploadingImages,
            errorCallback:  errorCallback,// A callback function used to define how to display an error message.
            errorMessages: {
               noFileGiven: 'Select a file.',
               typeNotAllowed: 'Uploading #image_name# was failed. The file type (#image_type#) is not supported.',
               fileTooLarge: 'Uploading #image_name# was failed. The file is too big (#image_size#).\n' +
                 'Maximum file size is #image_max_size#.',
               importError: 'Uploading #image_name# was failed. Something went wrong when uploading the file.',
             },
            status: [{
                className: 'message',
                defaultValue: function(el) {
                  el.innerHTML = '';
                },
                onUpdate: function(el) {
                },
              }
              , 'upload-image', {
              className: 'countOfRemainingChars',
              defaultValue: function(el, cm) {
                var countOfRemainingChars = maxCommentLength;
                var text = cm.getValue();
                if(text != null && text.length > 0) {
                  text = gdn.normalizeText(text);
                  countOfRemainingChars = maxCommentLength - text.length;
                  if(countOfRemainingChars < 0) {
                    countOfRemainingChars  = 0;
                  }
                }
                el.innerHTML = countOfRemainingChars +" character remaining";
              },
              onUpdate: function(el, cm) {
                var countOfRemainingChars = maxCommentLength;
                var text = cm.getValue();
                if(text != null && text.length > 0) {
                  text = gdn.normalizeText(text);
                  countOfRemainingChars = maxCommentLength - text.length;
                  if(countOfRemainingChars < 0) {
                    countOfRemainingChars  = 0;
                  }
                }
                el.innerHTML = countOfRemainingChars +" character remaining";
              },
            }],
          });

          // forceSync = true, need to clear form after async requests
          $currentEditableTextarea.closest('form').on('complete', function (frm, btn) {
            var mainEditor = allEditors[0];
            mainEditor.codemirror.setValue('');
          });

          editor.codemirror.on('change', function (cm, event) {
            var frm = $(cm.getInputField()).closest('form').first();
            var editorContainer = $(frm).find('.EasyMDEContainer');
            var messageContainer = $(frm).find('.editor-statusbar .message');

            var text = cm.getValue();
            text = gdn.normalizeText(text);
            if(text.length > 0 && text.length <= maxCommentLength) {
              $(editorContainer).removeClass('error');
              $(messageContainer).text('');
              $(frm).find(':submit').removeAttr("disabled");
              $(frm).find('.Buttons a.Button').removeClass('Disabled');
            } else if(text.length > maxCommentLength) {
              $(editorContainer).addClass('error');
              var count = text.length - maxCommentLength;
              $(messageContainer).text('Comment is '+ count + ' characters too long');
              $(frm).find(':submit').attr('disabled', 'disabled');
              $(frm).find('.Buttons a.Button:not(.Cancel)').addClass('Disabled');
            }

            // Key events don't work properly on Android Chrome
            if (!cm.state.completionActive /*Enables keyboard navigation in autocomplete list*/) {
                if (event.origin == '+input' && event.text && event.text.length > 0 && event.text[0] === '@') {
                  cm.showHint({ completeSingle: false, alignWithWord: true });
                  return;
              }
            }
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

          editor.codemirror.on('paste', function (cm, event) {
            var clipboard = event.clipboardData;
            var data = clipboard.getData('text/plain').trim();
            var rows = data.split((/[\u0085\u2028\u2029]|\r\n?/g)).map(function(row) {
              row = row.replace('\n', ' ')
              return row.split("\t")
            })
            var isTableData = looksLikeTable(rows);
            if(isTableData) {
              event.preventDefault();
            } else{
              return;
            }

            var colAlignments = [];

            var columnWidths = rows[0].map(function(column, columnIndex) {
              var alignment = "l";
              var re = /^(\^[lcr])/i;
              var m = column.match(re);
              if (m) {
                var align = m[1][1].toLowerCase();
                if (align === "c") {
                  alignment = "c";
                } else if (align === "r") {
                  alignment = "r";
                }
              }
              colAlignments.push(alignment);
              column = column.replace(re, "");
              rows[0][columnIndex] = column;
              return columnWidth(rows, columnIndex);
            });
            var markdownRows = rows.map(function(row, rowIndex) {
              // | col1   | col2 | col3  |
              // |--------|------|-------|
              // | val1   | val2 | val3  |
              return "| " + row.map(function(column, index) {
                return column + Array(columnWidths[index] - column.length + 1).join(" ")
              }).join(" | ") + " |";
            })
            markdownRows.splice(1, 0, "|" + columnWidths.map(function(width, index) {
              var prefix = "";
              var postfix = "";
              var adjust = 0;
              var alignment = colAlignments[index];
              if (alignment === "r") {
                postfix = ":";
                adjust = 1;
              } else if (alignment == "c") {
                prefix = ":";
                postfix = ":";
                adjust = 2;
              }
              return prefix + Array(columnWidths[index] + 3 - adjust).join("-") + postfix;
            }).join("|") + "|");

            var result =  "\n"+markdownRows.join("\n");
            var currentCursorPosition = cm.getCursor();
            cm.replaceSelection(result,{line: currentCursorPosition.line+2, ch: result.length});
            return false;
          });

          // We have only one main editor at a page which should used for quote/replyto
          // FIX: https://github.com/topcoder-platform/forums/issues/540
          if(allEditors.length == 0) {
            allEditors.push(editor);
          }
        }
    }; //editorInit

    editorInit(this);
    // jQuery chaining
    return this;
  };

  $(document).on('contentLoad', function(e) {
    if ($('.BodyBox[format="Markdown"], .BodyBox[format="wysiwyg"],.js-bodybox[format="Markdown"], .js-bodybox[format="wysiwyg"]', e.target).length === 0) {
      return;
    }
    // Multiple editors are supported on a page
    $('.BodyBox[format="Markdown"], .BodyBox[format="wysiwyg"],.js-bodybox[format="Markdown"], .js-bodybox[format="wysiwyg"]', e.target).setAsEditor();
    var categorySelect = $(this).find('#DiscussionForm select');
    if(categorySelect.length) {
      var selectedOption = categorySelect.find('option:selected');
      var uploads = selectedOption.attr("uploads");
      editor.enableUploadImages(uploads === "1");
    }
    editor.updateToolbar();
  });

  $(document).on('change','#DiscussionForm select', function() {
    var element = $(this).find('option:selected');
    var categoryID = element.val();
    if($(this).id != '#Form_CategoryID') {
      var postForm = $(element).closest('form');
      $(postForm).find('#Form_CategoryID').val(categoryID);
    }
    var uploads = element.attr("uploads");
    var mainEditor = allEditors[0];
    mainEditor.enableUploadImages(uploads === "1");
  });

  // Preview mode
  $(document).on('PreviewLoaded',function(ev) {
    if(MathJax) {
      MathJax.typeset();
    }
  });

  // Comment was added\edited
  $(document).on('CommentAdded',function(ev) {
    if(MathJax) {
      MathJax.typeset();
    }
  });

  // Comment with quotes
  $(document).on('ApplyQuoteText',function(ev, quoteText, ed) {
     var mainEditor = allEditors[0];
     var text = mainEditor.value();
     mainEditor.value(quoteText + '\n' + text + '\n');
  });
}(jQuery));
