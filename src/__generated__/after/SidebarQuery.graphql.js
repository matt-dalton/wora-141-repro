/**
 * @generated SignedSource<<6252b37bdd677c5c35522e2eb84c33a9>>
 * @lightSyntaxTransform
 * @nogrep
 */

/* eslint-disable */

'use strict';

var node = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "User",
    "kind": "LinkedField",
    "name": "me",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "id",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "name",
        "storageKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "SidebarQuery",
    "selections": (v0/*: any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "SidebarQuery",
    "selections": (v0/*: any*/)
  },
  "params": {
    "cacheID": "37241eb07f33d72004b4e7ef2be549f1",
    "id": null,
    "metadata": {},
    "name": "SidebarQuery",
    "operationKind": "query",
    "text": "query SidebarQuery {\n  me {\n    id\n    name\n  }\n}\n"
  }
};
})();

node.hash = "5b8b1464674ccd9e780b8cf951ff7f25";

export default node;
