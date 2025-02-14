namespace BibleOnSite.Model.Services
{
    using System.Linq;
    using System.Net;
    using System.Net.Sockets;

    public class BaseGraphQLService
    {
        private readonly string url;
        public BaseGraphQLService()
        {
            // Get the host entry for the local machine
            var host = Dns.GetHostEntry(Dns.GetHostName());
            // TODO: set this for DEV profile and set תנך.co.il for PROD profile
            var HOST_LOOPBACK = "10.0.2.2";
            url = $"http://{HOST_LOOPBACK}:3003/api/graphql";
        }
        public string Url
        {
            get
            {
                return url;
            }
        }
    }
}