<?php

if (!class_exists('League\HTMLToMarkdown\HtmlConverter')){
    require __DIR__ . '/vendor/autoload.php';
}


use Vanilla\Formatting\Formats\MarkdownFormat;
use \Vanilla\Formatting\Formats;
use Vanilla\Formatting\Formats\RichFormat;
use League\HTMLToMarkdown\HtmlConverter;


/**
 * Plugin class for the Topcoder Editor
 */
class TopcoderEditorPlugin extends Gdn_Plugin {

    const FORMAT_NAME = MarkdownFormat::FORMAT_KEY;

    // TODO: Need to support quotes
    // TODO: Uploading files
    const QUOTE_CONFIG_ENABLE = "TopcoderEditor.Quote.Enable";

    /** @var integer */
    private static $editorID = 0;

    /** @var \Vanilla\Formatting\FormatService */
    private $formatService;

    /** @var string Asset path for this plugin, set in Gdn_Form_BeforeBodyBox_Handler. */
    private $assetPath;

    /** @var bool  */
    private $canUpload;

    /** @var array Give class access to PluginInfo */
    private $pluginInfo = [];

    /**
     * Set some properties we always need.
     *
     * @param \Vanilla\Formatting\FormatService $formatService
     */
    public function __construct(\Vanilla\Formatting\FormatService $formatService) {
        $this->formatService = $formatService;
        parent::__construct();
        self::$editorID++;
        $this->pluginInfo = Gdn::pluginManager()->getPluginInfo('TopcoderEditor', Gdn_PluginManager::ACCESS_PLUGINNAME);
        $this->assetPath = asset('/plugins/TopcoderEditor');
    }

    /**
     * Load CSS into head for editor
     */
    public function assetModel_styleCss_handler($sender) {
        $sender->addCssFile('easymde.min.css', 'plugins/TopcoderEditor');
        $sender->addCssFile('show-hint.css', 'plugins/TopcoderEditor');
    }

    /**
     * Add Javascript to discussion pages.
     *
     * @param discussionController $sender
     */
    public function discussionController_render_before($sender) {
        $this->beforeRender($sender);
    }

    /**
     * Add Javascript to post pages.
     *
     * @param postController $sender
     */
    public function postController_render_before($sender) {
        $this->beforeRender($sender);
    }

    private function beforeRender($sender){
        $sender->addJsFile('codemirror.js', 'plugins/TopcoderEditor');
        $sender->addJsFile('easymde.min.js', 'plugins/TopcoderEditor');
        $sender->addJsFile('topcodereditor.js', 'plugins/TopcoderEditor');
        $c = Gdn::controller();

        // Set formats
        $c->addDefinition('defaultInputFormat', c('Garden.InputFormatter'));
        $c->addDefinition('defaultMobileInputFormat', c('Garden.MobileInputFormatter'));

        // Set file uploads vars
        $postMaxSize = Gdn_Upload::unformatFileSize(ini_get('post_max_size'));
        $fileMaxSize = Gdn_Upload::unformatFileSize(ini_get('upload_max_filesize'));
        $configMaxSize = Gdn_Upload::unformatFileSize(c('Garden.Upload.MaxFileSize', '1MB'));
        $maxSize = min($postMaxSize, $fileMaxSize, $configMaxSize);
        $c->addDefinition('maxUploadSize', $maxSize);

        // Save allowed file types
        // TODO: upload files
        $allowedFileExtensions = c('Garden.Upload.AllowedFileExtensions');
        $imageExtensions = ['gif', 'png', 'jpeg', 'jpg', 'bmp', 'tif', 'tiff', 'svg'];
        $allowedImageExtensions = array_intersect($allowedFileExtensions, $imageExtensions);
        $c->addDefinition('allowedImageExtensions', json_encode($allowedImageExtensions));
        $c->addDefinition('allowedFileExtensions', json_encode($allowedFileExtensions));
        // Get max file uploads, to be used for max drops at once.
        $c->addDefinition('maxFileUploads', ini_get('max_file_uploads'));

        // Set editor definitions
        $c->addDefinition('editorVersion', $this->pluginInfo['Version']);
        $c->addDefinition('editorInputFormat', ucfirst(self::FORMAT_NAME));
        $c->addDefinition('editorPluginAssets', $this->AssetPath);

        $additionalDefinitions = [];
        $this->EventArguments['definitions'] = &$additionalDefinitions;
        $this->fireEvent('GetJSDefinitions');

    }

    /**
     * {@inheritDoc}
     */
    public function setup() {
        saveToConfig('Garden.InputFormatter', MarkdownFormat::FORMAT_KEY);
        saveToConfig('Garden.MobileInputFormatter', MarkdownFormat::FORMAT_KEY);
        saveToConfig(self::QUOTE_CONFIG_ENABLE, true);
        saveToConfig('EnabledPlugins.Quotes', false);
    }

    public function onDisable() {
        Gdn::config()->saveToConfig('Garden.InputFormatter', 'Text');
        Gdn::config()->saveToConfig('Garden.MobileInputFormatter', 'Text');
    }

    /**
     * @return int
     */
    public static function getEditorID(): int {
        return self::$editorID;
    }

    /**
     * Check to see if we should be using the Topcoder Editor
     *
     * @param Gdn_Form $form - A form instance.
     *
     * @return bool
     */
    public function isFormMarkDown(Gdn_Form $form): bool {
        $data = $form->formData();
        $format = $data['Format'] ?? null;

        if (Gdn::config('Garden.ForceInputFormatter')) {
            return $this->isInputFormatterMarkDown();
        }

        return strcasecmp($format, MarkdownFormat::FORMAT_KEY) === 0;
    }

    /**
     * Check to see if we should be using the Topcoder Editor
     *
     * @param Gdn_Form $form - A form instance.
     *
     * @return bool
     */
    public function isFormWysiwyg(Gdn_Form $form): bool {
        $data = $form->formData();
        $format = $data['Format'] ?? null;
        return strcasecmp($format, Vanilla\Formatting\Formats\WysiwygFormat::FORMAT_KEY) === 0;
    }

    public function isInputFormatterMarkDown(): bool {
        return strcasecmp(Gdn_Format::defaultFormat(), MarkdownFormat::FORMAT_KEY) === 0;
    }

    /**
     * Add the editor format to the posting page.
     *
     * @param string[] $postFormats Existing post formats.
     *
     * @return string[] Additional post formats.
     */
    public function getPostFormats_handler(array $postFormats): array {
        $postFormats[] = 'Markdown'; // The config values have always been uppercase. (including in default configs).
        return $postFormats;
    }

    public function postController_beforeEditDiscussion_handler($sender, $args) {
        $discussion = &$args['Discussion'];
        if($discussion) {
            if (strcasecmp($discussion->Format, Vanilla\Formatting\Formats\WysiwygFormat::FORMAT_KEY) === 0) {
                $converter = new HtmlConverter();
                $discussion->Body = $converter->convert($discussion->Body) ;
                $discussion->Format = 'Markdown';
            }
        }
    }

    /**
     * Attach editor anywhere 'BodyBox' is used.
     *
     * It is not being used for editing a posted reply, so find another event to hook into.
     *
     * @param Gdn_Form $sender The Form Object
     * @param array $args Arguments from the event.
     */
    public function gdn_form_beforeBodyBox_handler(Gdn_Form $sender, array $args) {
        $attributes = [];
        if (val('Attributes', $args)) {
            $attributes = val('Attributes', $args);
        }
        /** @var Gdn_Controller $controller */
        $controller = Gdn::controller();
        $data = $sender->formData();
        $controller->addDefinition('originalFormat', $data['Format']);

        if ($this->isFormMarkDown($sender) || $this->isFormWysiwyg($sender) ) {
            $controller->CssClass .= 'hasRichEditor hasTopcoderEditor'; // hasRichEditor = to support Rich editor

            $editorID = $this->getEditorID();

            $editorToolbar = $this->getEditorToolbar($attributes);
            //$this->EventArguments['EditorToolbar'] = &$editorToolbar;
            //$this->fireEvent('InitTopcoderEditorToolbar');

            $controller->addDefinition('topcoderEditorToolbar', $editorToolbar);
            $controller->setData('topcoderEditorData', [
                'editorID' => $editorID,
                'editorDescriptionID' => 'topcoderEditor-'.$editorID.'-description',
                'hasUploadPermission' => checkPermission('uploads.add'),
            ]);
            // Render the editor view.
            $args['BodyBox'] .= $controller->fetchView('editor', '', 'plugins/TopcoderEditor');
        } elseif (c('Garden.ForceInputFormatter')) {
            $originalRecord = $sender->formData();
            $newBodyValue = null;
            $body = $originalRecord['Body'] ?? false;
            $originalRecord = $sender->formData();
            $originalFormat = $originalRecord['Format']? strtolower($originalRecord['Format']) : false;
            /*
                Allow rich content to be rendered and modified if the InputFormat
                is different from the original format in no longer applicable or
                forced to be different by Garden.ForceInputFormatter.
            */
            if ($body && (c('Garden.InputFormatter') !== $originalFormat)) {
                switch (strtolower(c('Garden.InputFormatter', 'unknown'))) {
                    case Formats\TextFormat::FORMAT_KEY:
                    case Formats\TextExFormat::FORMAT_KEY:
                        $newBodyValue = $this->formatService->renderPlainText($body, Formats\TextFormat::FORMAT_KEY);
                        $sender->setValue("Body", $newBodyValue);
                        break;
                    case Formats\RichFormat::FORMAT_KEY:
                        $newBodyValue = $this->formatService->renderPlainText($body, Formats\RichFormat::FORMAT_KEY);
                        $sender->setValue("Body", $newBodyValue);
                        break;
                    case 'unknown':
                        // Do nothing
                        break;
                    default:
                        $newBodyValue = $this->formatService->renderPlainText($body, Formats\HtmlFormat::FORMAT_KEY);
                        $sender->setValue("Body", $newBodyValue);
                }
            }
        }
    }

    /**
     * Add 'Quote' option to discussion via the reactions row after each post.
     *
     * @param Gdn_Controller $sender
     * @param array $args
     */
    public function base_afterFlag_handler($sender, $args) {
        if ($this->isInputFormatterMarkDown() && c(self::QUOTE_CONFIG_ENABLE, true)) {
          //  $this->addQuoteButton($sender, $args);
        }
    }

    /**
     * Output Quote link.
     *
     * @param Gdn_Controller $sender
     * @param array $args
     */
    protected function addQuoteButton($sender, $args) {
        // There are some case were Discussion is not set as an event argument so we use the sender data instead.
        $discussion = $sender->data('Discussion');
        $discussion = (is_array($discussion)) ? (object)$discussion : $discussion;

        if (!$discussion) {
            return;
        }


        if (!Gdn::session()->UserID) {
            return;
        }

        if (!Gdn::session()->checkPermission('Vanilla.Comments.Add', false, 'Category', $discussion->PermissionCategoryID)) {
            return;
        }

        if (isset($args['Comment'])) {
            $url = commentUrl($args['Comment']);
        } elseif ($discussion) {
            $url = discussionUrl($discussion);
        } else {
            return;
        }

        $icon = sprite('ReactQuote', 'ReactSprite');
        $linkText = $icon.' '.t('Quote');
        $classes = 'ReactButton Quote Visible js-quoteButton';

        echo Gdn_Theme::bulletItem('Flags');
        echo "<a href='#' role='button' data-scrape-url='$url' role='button' class='$classes'>$linkText</a>";
        echo ' ';
    }

    /**
     * Add additional WYSIWYG specific form item to the dashboard posting page.
     *
     * @param string $additionalFormItemHTML
     * @param Gdn_Form $form The Form instance from the page.
     * @param Gdn_ConfigurationModel $configModel The config model used for the Form.
     *
     * @return string The built up form html
     */
    public function postingSettings_formatSpecificFormItems_handler1(
        string $additionalFormItemHTML,
        Gdn_Form $form,
        Gdn_ConfigurationModel $configModel
    ): string {
        $enableTopcoderEditorQuotes = t('Enable Topcoder Quotes');
        $richEditorQuotesNotes =  t('TopcoderEditor.QuoteEnable.Notes', 'Use the following option to enable quotes for the Topcoder Editor. This will only apply if the default formatter is "Markdown".');
        $label = '<p class="info">'.$richEditorQuotesNotes.'</p>';
        $configModel->setField(self::QUOTE_CONFIG_ENABLE);

        $form->setValue(self::QUOTE_CONFIG_ENABLE, c(self::QUOTE_CONFIG_ENABLE));
        $formToggle = $form->toggle(self::QUOTE_CONFIG_ENABLE, $enableTopcoderEditorQuotes, [], $label);

        $additionalFormItemHTML .= "<li class='form-group js-richFormGroup Hidden' data-formatter-type='Rich'>$formToggle</li>";
        return $additionalFormItemHTML;
    }


    /**
     * This method will grab the permissions array from getAllowedEditorActions,
     * build the editor toolbar, then filter out the allowed ones and return it.
     *
     * @param array $editorToolbar Holds the final copy of allowed editor actions
     * @param array $editorToolbarAll Holds the "kitchen sink" of editor actions
     * @return array Returns the array of allowed editor toolbar actions
     */
    protected function getEditorToolbar($attributes = []) {
        $defaultEditorToolbar = [
            "bold",
            "italic",
            "strikethrough",
            "|",
            "heading-1",
            "heading-2",
            "heading-3",
            "|",
            "code",
            "quote",
            "|",
            "unordered-list",
            "ordered-list",
            "clean-block",
            "|",
            "mentions",
            "link",
            "image",
            "table",
            "horizontal-rule",
            "|",
            "fullscreen",
            "|" ,
            "guide"
        ];
        $allowedEditorActions = $this->getAllowedEditorActions();

        // TODO : allowed actions
        $fileUpload = val('FileUpload', $attributes);
        $imageUpload = $fileUpload || val('ImageUpload', $attributes, true);
        if (($fileUpload || $imageUpload) && $this->canUpload()) {
            $allowedEditorActions['fileupload'] = $fileUpload;
            $allowedEditorActions['imageupload'] = $imageUpload;
            $allowedEditorActions['image'] = !$imageUpload;
        }

        // Let plugins and themes override the defaults.
        $this->EventArguments['actions'] = &$allowedEditorActions;
        $this->fireEvent('topcoderToolbarConfig');

        // Filter out disallowed editor actions
        foreach ($allowedEditorActions as $editorAction => $allowed) {
            if ($allowed == false && isset($defaultEditorToolbar[$editorAction])) {
                //$editorToolbar[$editorAction] = $editorToolbarAll[$editorAction];
                unset($defaultEditorToolbar[$editorAction]);
            }
        }

        return $defaultEditorToolbar;
    }


    /**
     * Set the editor actions to true or false to enable or disable the action
     * from displaying in the editor toolbar.
     *
     * This will also let you toggle the separators from appearing between the loosely grouped actions.
     *
     * @return array List of allowed editor actions
     */
    public function getAllowedEditorActions() {
        static $allowedEditorActions = [
            "bold" => true,
            "italic" => true,
            "strikethrough" => true,
            "heading-1" => true,
            "heading-2" => true,
            "heading-3" => true,
            "code" => true,
            "quote" => true,
            "unordered-list" => true,
            "ordered-list" => true,
            "clean-block" => true,
            "mentions" => true,
            "link" => true,
            "image" => true,
            "table" => true,
            "horizontal-rule" => true,
            "fullscreen" =>true,
            "guide" =>true
        ];

        return $allowedEditorActions;
    }

    /**
     * Checks whether the canUpload property is set and if not, calculates it value.
     * The calculation is based on config, user permissions, and category permissions.
     *
     * @return bool Whether the session user is allowed to upload a file.
     */
    protected function canUpload() {
        // If the property has been set, return it
        if (isset($this->canUpload)) {
            return $this->canUpload;
        } else {
            // Check config and user role upload permission
            if (c('Garden.AllowFileUploads', true) && Gdn::session()->checkPermission('Plugins.Attachments.Upload.Allow', false)) {
                // Check category-specific permission
                $permissionCategory = CategoryModel::permissionCategory(Gdn::controller()->data('Category'));
                $this->canUpload = val('AllowFileUploads', $permissionCategory, true);
            } else {
                $this->canUpload = false;
            }
        }
        return $this->canUpload;
    }

    public static function log($message, $data= []) {
        if (c('Debug')) {
            Logger::event(
                'TopcoderEditorPlugin',
                Logger::DEBUG,
                $message,
                $data
            );
        }
    }
}
