using System.Text;
using System.Text.Json;
using GraphQL;
using GraphQL.Client.Http;
using GraphQL.Client.Serializer.Newtonsoft;
using Newtonsoft.Json;

namespace BibleOnSite.Model.Services
{
    public class AuthorsService : BaseGraphQLService
    {
        public AuthorsService()
        {
        }
        public async Task<List<Author>> GetAuthors()
        {
            var client = new GraphQLHttpClient(Url, new NewtonsoftJsonSerializer());
            var request = new GraphQLRequest
            {
                OperationName = null,
                Variables = new object(),
                Query = "{\n  authorById(id: 1) {\n    id\n    name\n    details\n  }\n}\n",
            };
            try
            {
                String reqBody = JsonConvert.SerializeObject(request);
                var res = await new HttpClient().PostAsync(Url, new StringContent(reqBody, Encoding.UTF8));
                var resBody = await res.Content.ReadAsStringAsync();
                var graphQLResponse = JsonConvert.DeserializeObject<AuthorGraphQLResponse>(resBody)!;
                // var response = graphQLResponse.Data;
                // Convert the single author to a list to maintain the return type.
                Author author = new() { Id = graphQLResponse.Data.AuthorById.Id, Name = graphQLResponse.Data.AuthorById.Name, Details = graphQLResponse.Data.AuthorById.Details };
                return [author];

            }
            catch (System.Exception ex)
            {
                System.Diagnostics.Debug.WriteLine(ex.Message);
                return [];
            }
        }
    }

    public class AuthorGraphQLResponse
    {
        [JsonProperty("data")]
        public required AuthorResponse Data { get; set; }
    }

    public class AuthorResponse
    {
        [JsonProperty("authorById")]
        public required Author AuthorById { get; set; }
    }

    public class Author
    {
        [JsonProperty("id")]
        public int Id { get; set; }

        [JsonProperty("name")]
        public required string Name { get; set; }

        [JsonProperty("details")]
        public required string Details { get; set; }
    }
}