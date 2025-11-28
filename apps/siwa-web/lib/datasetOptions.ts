export const DATASET_TYPES = [
  { value: "image", label: "Image" },
  { value: "text", label: "Text" },
];

export const IMAGE_TASK_OPTIONS = [
  { value: "classification", label: "Single-label Multiclass Classification" },
  { value: "multiclassification", label: "Multi-label Classification" },
  { value: "detection", label: "Object detection" },
  // { value: "segmentation", label: "Segmentation" },
  { value: "captioning", label: "Captioning" },
  { value: "grounding", label: "Visual Grounding" },  
];

export const TEXT_TASK_OPTIONS = [
  { value: "text_classification", label: "Text classification" },
  { value: "text_generation", label: "Text generation" },
  { value: "text_summarization", label: "Text summarization" },
];

export const SEGMENTATION_FORMATS = [
  // { value: "mask", label: "Binary/PNG mask" },
  { value: "rle", label: "Run-length encoding (RLE)" },
  // { value: "polygon", label: "Polygon/points" },
  { value: "bounding_box", label: "Bounding boxes" },
  // { value: "points", label: "Keypoints" },
  // { value: "other", label: "Other / custom" },
];

export const DETECTION_FORMATS = [
  {
    value: "yolo",
    label: "YOLO txt (class x_center y_center width height, normalized)",
  },
  {
    value: "pascal_voc",
    label: "Pascal VOC (class xmin ymin xmax ymax, pixels)",
  },
  {
    value: "coco_bbox",
    label: "COCO bbox (class x y width height, pixels)",
  },
];

export const FILE_PATTERN_PRESETS = [
  {
    id: "images",
    label: "Images (png / jpg / jpeg)",
    value: "*.png,*.jpg,*.jpeg",
  },
  {
    id: "dicom",
    label: "DICOM (*.dcm)",
    value: "*.dcm",
  },
  {
    id: "custom",
    label: "Custom",
    value: "",
  },
];
