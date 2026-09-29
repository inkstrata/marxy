The registry gate now treats compound assignments to `innerHTML` and `outerHTML` (for example `+=`) like plain `=`, so an unsanitised HTML write cannot slip past `innerHtmlAllowedIn` (MARXY-306)
