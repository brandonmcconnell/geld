**P2** **Fenced examples become review claims**

A CRF block written inside a fenced code block (an example in a README or a reply) is read as the comment's own claim, so documentation about CRF can change a bot's verdict.

<!-- crf:v0 {"schema":"crf/v0","bot":{"name":"Greptile","app":"greptile-apps"},"kind":"finding","run":{"id":"greptile-86326225"},"finding":{"id":"fenced-examples-become-claims","title":"Fenced examples become review claims","severity":"medium","location":{"path":"packages/crf/src/carrier.ts","line":45,"side":"RIGHT"},"category":"bug","vendorSeverity":"P2","commentId":4390820048}} -->
