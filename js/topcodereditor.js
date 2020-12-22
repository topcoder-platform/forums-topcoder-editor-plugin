(function($) {
  $.fn.setAsEditor = function(selector) {
    selector = selector || 'textarea#Form_Body';

    // If editor can be loaded, add class to body
    $('body').addClass('topcodereditor-active');

    /**
     * Determine editor format to load, and asset path, default to Wysiwyg
     */
    var editor,
      editorCacheBreakValue = Math.random(),
      editorVersion = gdn.definition('editorVersion', editorCacheBreakValue),
      formatOriginal = gdn.definition('editorInputFormat', 'Markdown'),
      topcoderEditorToolbar = gdn.definition('topcoderEditorToolbar'),
      debug = true;

    var toolbarCustomActions  =  [{
      name: "mentions",
      action: function mentions(editor) {
          completeAfter(editor.codemirror);
      },
      className: "fa fa-at",
      title: "Mention a Topcoder User",

    }];

    for( var action of toolbarCustomActions) {
      var index = topcoderEditorToolbar.indexOf(action.name);
      if(index > -1) {
        topcoderEditorToolbar[index] = action;
      }
    }

    console.log('topcoderEditorData:' + JSON.stringify(topcoderEditorToolbar));
    /**
     * Load relevant stylesheets into editor iframe. The first one loaded is
     * the actual editor.css required for the plugin. The others are extra,
     * grabbed from the source of parent to iframe, as different communities
     * may have styles they want injected into the iframe.
     */

    if (debug) {
      editorVersion += '&cachebreak=' + editorCacheBreakValue;
    }

    function logMessage(message) {
      console.log('TopcoderPlugin::'+ message);
    }

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

    /**
     * Initialize editor on the page.
     *
     */
    var editorInit = function(textareaObj) {
      var $currentEditableTextarea = $(textareaObj);

      // if found, perform operation
      if ($currentEditableTextarea.length) {
        // instantiate new editor
        var editor = new EasyMDE({
          shortcuts: {
            "mentions":"Ctrl-Space",
          },
          autofocus: false,
          forceSync: true, // true, force text changes made in EasyMDE to be immediately stored in original text area.
          placeholder: '',
          element: $currentEditableTextarea[0],
          hintOptions: {hint: topcoderHandles},
          // toolbar: topcoderEditorToolbar,
          toolbar: ["bold", "italic", "strikethrough", "|",
          "heading-1", "heading-2", "heading-3", "|", "code", "quote", "|", "unordered-list",
          "ordered-list", "clean-block", "|", {
              name: "mentions",
              action: function mentions(editor) {
                completeAfter(editor.codemirror);
              },
              className: "fa fa-at",
              title: "Mention a Topcoder User",

            }, "link", "image", "table", "horizontal-rule", "|", "fullscreen", "|", "guide"],
          hideIcons: ["guide", "heading", "preview", "side-by-side"],
          insertTexts: {
            horizontalRule: ["", "\n\n-----\n\n"],
            image: ["![](https://", ")"],
            link: ["[", "](https://)"],
            table: ["", "\n\n| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Text     | Text      | Text     |\n\n"],
          },
          // uploadImage: false by default,  If set to true, enables the image upload functionality, which can be triggered by drag&drop, copy-paste and through the browse-file window (opened when the user click on the upload-image icon). Defaults to false.
          // imageMaxSize: Maximum image size in bytes, checked before upload (note: never trust client, always check image size at server-side). Defaults to 1024*1024*2 (2Mb).
          // imageAccept: A comma-separated list of mime-types used to check image type before upload (note: never trust client, always check file types at server-side). Defaults to image/png, image/jpeg.
          // imageUploadEndpoint: The endpoint where the images data will be sent, via an asynchronous POST request
          // imageTexts:
          // errorMessages: Errors displayed to the user, using the errorCallback option,
          // errorCallback: A callback function used to define how to display an error message.
          // renderingConfig: Adjust settings for parsing the Markdown during previewing (not editing)
          // showIcons: An array of icon names to show. Can be used to show specific icons hidden by default without completely customizing the toolbar.
          // sideBySideFullscreen: If set to false, allows side-by-side editing without going into fullscreen. Defaults to true.
          //theme: Override the theme. Defaults to easymde.
        });

        // forceSync = true, need to clear form after async requests
        $currentEditableTextarea.closest('form').on('complete', function(frm, btn) {
          editor.codemirror.setValue('');
        });

        editor.codemirror.on('change', function (cm, changeObj){
           // logMessage('onChange:'+cm.getCursor().ch);
        });

        editor.codemirror.on('keydown', function (cm, event){
          if (!cm.state.completionActive /*Enables keyboard navigation in autocomplete list*/) {
            if(event.key == '@') {
              var currentCursorPosition = cm.getCursor();
              if(currentCursorPosition.ch === 0) {
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
    } //editorInit

    editorInit(this);

    // jQuery chaining
    return this;
  };

  $(document).on('contentLoad', function(e) {
    if ($('textarea#Form_Body', e.target).length === 0) {
      console.log('Couldn\'t load EasyMDE: missing #Form_Body');
      return;
    }
    // Vanilla Form
    $('textarea#Form_Body', e.target).setAsEditor();
  });
}(jQuery));
