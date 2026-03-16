// Wiki.js GraphQL client
// Requirements: 4.1, 4.5, 5.3

const LIST_QUERY = '{ pages { list(orderBy: UPDATED, orderByDirection: DESC) { id path title updatedAt } } }';
const SINGLE_QUERY = 'query ($id: Int!) { pages { single(id: $id) { id path title content updatedAt } } }';
const SINGLE_BY_PATH_QUERY = 'query ($path: String!, $locale: String!) { pages { singleByPath(path: $path, locale: $locale) { id path title content updatedAt } } }';

const CREATE_MUTATION = `
  mutation CreatePage(
    $content: String!,
    $description: String!,
    $editor: String!,
    $isPrivate: Boolean!,
    $isPublished: Boolean!,
    $locale: String!,
    $path: String!,
    $publishEndDate: Date,
    $publishStartDate: Date,
    $scriptCss: String,
    $scriptJs: String,
    $tags: [String]!,
    $title: String!
  ) {
    pages {
      create(
        content: $content,
        description: $description,
        editor: $editor,
        isPrivate: $isPrivate,
        isPublished: $isPublished,
        locale: $locale,
        path: $path,
        publishEndDate: $publishEndDate,
        publishStartDate: $publishStartDate,
        scriptCss: $scriptCss,
        scriptJs: $scriptJs,
        tags: $tags,
        title: $title
      ) {
        responseResult {
          succeeded
          errorCode
          slug
          message
        }
        page {
          id
          path
          title
          description
          isPrivate
          isPublished
          tags {
            id
            tag
            title
          }
          content
          updatedAt
        }
      }
    }
  }
`;

const UPDATE_MUTATION = `
  mutation UpdatePage(
    $id: Int!,
    $content: String,
    $description: String,
    $editor: String,
    $isPrivate: Boolean,
    $isPublished: Boolean,
    $locale: String,
    $path: String,
    $publishEndDate: Date,
    $publishStartDate: Date,
    $scriptCss: String,
    $scriptJs: String,
    $tags: [String],
    $title: String
  ) {
    pages {
      update(
        id: $id,
        content: $content,
        description: $description,
        editor: $editor,
        isPrivate: $isPrivate,
        isPublished: $isPublished,
        locale: $locale,
        path: $path,
        publishEndDate: $publishEndDate,
        publishStartDate: $publishStartDate,
        scriptCss: $scriptCss,
        scriptJs: $scriptJs,
        tags: $tags,
        title: $title
      ) {
        responseResult {
          succeeded
          errorCode
          slug
          message
        }
        page {
          id
          path
          title
          description
          isPrivate
          isPublished
          tags {
            id
            tag
            title
          }
          content
          updatedAt
        }
      }
    }
  }
`;

async function gqlRequest(url, body, token = null) {
  const delays = [100, 200];
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1]));
    }
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const json = await response.json();
      return json.data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function listPages(baseUrl) {
  const data = await gqlRequest(`${baseUrl}/graphql`, { query: LIST_QUERY });
  return data.pages.list;
}

export async function getPageContent(baseUrl, pageId, token = null) {
  const data = await gqlRequest(`${baseUrl}/graphql`, {
    query: SINGLE_QUERY,
    variables: { id: pageId },
  }, token);
  const page = data.pages.single;
  if (!page) throw new Error(`Page not found: ${pageId}`);
  return page;
}

export async function getPageByPath(baseUrl, pagePath, locale = 'en', token = null) {
  const data = await gqlRequest(`${baseUrl}/graphql`, {
    query: SINGLE_BY_PATH_QUERY,
    variables: { path: pagePath, locale },
  }, token);
  const page = data.pages.singleByPath;
  if (!page) throw new Error(`Page not found: ${pagePath}`);
  return page;
}

export async function createPage(baseUrl, token, pageData) {
  const variables = {
    title: pageData.title,
    path: pageData.path,
    content: pageData.content,
    description: pageData.description || '',
    tags: pageData.tags || [],
    isPublished: pageData.isPublished !== undefined ? pageData.isPublished : true,
    isPrivate: pageData.isPrivate !== undefined ? pageData.isPrivate : false,
    locale: pageData.locale || 'en',
    editor: pageData.editor || 'markdown',
    publishEndDate: pageData.publishEndDate || null,
    publishStartDate: pageData.publishStartDate || null,
    scriptCss: pageData.scriptCss || '',
    scriptJs: pageData.scriptJs || '',
  };

  const data = await gqlRequest(
    `${baseUrl}/graphql`,
    {
      query: CREATE_MUTATION,
      variables,
    },
    token
  );

  return data.pages.create;
}

export async function updatePage(baseUrl, token, pageId, updates) {
  const variables = {
    id: pageId,
  };

  // Only include fields that are provided (partial updates)
  if (updates.content !== undefined) variables.content = updates.content;
  if (updates.title !== undefined) variables.title = updates.title;
  if (updates.description !== undefined) variables.description = updates.description;
  if (updates.tags !== undefined) variables.tags = updates.tags;
  if (updates.isPublished !== undefined) variables.isPublished = updates.isPublished;
  if (updates.isPrivate !== undefined) variables.isPrivate = updates.isPrivate;
  if (updates.locale !== undefined) variables.locale = updates.locale;
  if (updates.path !== undefined) variables.path = updates.path;
  if (updates.editor !== undefined) variables.editor = updates.editor;
  if (updates.publishEndDate !== undefined) variables.publishEndDate = updates.publishEndDate;
  if (updates.publishStartDate !== undefined) variables.publishStartDate = updates.publishStartDate;
  if (updates.scriptCss !== undefined) variables.scriptCss = updates.scriptCss;
  if (updates.scriptJs !== undefined) variables.scriptJs = updates.scriptJs;

  const data = await gqlRequest(
    `${baseUrl}/graphql`,
    {
      query: UPDATE_MUTATION,
      variables,
    },
    token
  );

  return data.pages.update;
}

const DELETE_MUTATION = `
  mutation DeletePage($id: Int!) {
    pages {
      delete(id: $id) {
        responseResult {
          succeeded
          errorCode
          slug
          message
        }
      }
    }
  }
`;

export async function deletePage(baseUrl, token, pageId) {
  const data = await gqlRequest(
    `${baseUrl}/graphql`,
    {
      query: DELETE_MUTATION,
      variables: { id: pageId },
    },
    token
  );
  return data.pages.delete;
}

const MOVE_MUTATION = `
  mutation MovePage($id: Int!, $destinationPath: String!, $destinationLocale: String!) {
    pages {
      move(id: $id, destinationPath: $destinationPath, destinationLocale: $destinationLocale) {
        responseResult {
          succeeded
          errorCode
          slug
          message
        }
      }
    }
  }
`;

export async function movePage(baseUrl, token, pageId, destinationPath, destinationLocale = 'en') {
  const data = await gqlRequest(
    `${baseUrl}/graphql`,
    {
      query: MOVE_MUTATION,
      variables: { id: pageId, destinationPath, destinationLocale },
    },
    token
  );
  return data.pages.move;
}
