// The film's scenes, in chapter order (see ../timeline.js). Chapters without a drawn scene
// yet use a placeholder sheet.

import vibrate from "./vibrate.js";
import assemble from "./assemble.js";
import connect from "./connect.js";
import control from "./control.js";
import count from "./count.js";
import delegate from "./delegate.js";
import end from "./end.js";
import play from "./play.js";
import electrify from "./electrify.js";
import record from "./record.js";
import repeat from "./repeat.js";
import write from "./write.js";

export const scenes = [
  vibrate,
  write,
  repeat,
  record,
  electrify,
  control,
  count,
  connect,
  assemble,
  delegate,
  play,
  end,
];
